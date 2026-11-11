-- Marketplace payment gates and an auditable organizer-share ledger.
alter table public.events
  add column if not exists listing_fee_status text not null default 'unpaid',
  add column if not exists razorpay_listing_order_id text,
  add column if not exists razorpay_listing_payment_id text;

alter table public.events drop constraint if exists events_listing_fee_status_check;
alter table public.events add constraint events_listing_fee_status_check
  check (listing_fee_status in ('unpaid', 'paid'));

-- Existing live listings predate checkout; preserve their published state.
update public.events set listing_fee_status='paid', listing_fee_paise=25000
where status='published' and listing_fee_status='unpaid';

create or replace function public.protect_event_listing_payment()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.role() is distinct from 'service_role' and (
    (tg_op='INSERT' and (new.listing_fee_status <> 'unpaid' or new.razorpay_listing_order_id is not null or new.razorpay_listing_payment_id is not null))
    or (tg_op='UPDATE' and (
      new.listing_fee_status is distinct from old.listing_fee_status
      or new.razorpay_listing_order_id is distinct from old.razorpay_listing_order_id
      or new.razorpay_listing_payment_id is distinct from old.razorpay_listing_payment_id
    ))
  ) then
    raise exception 'Event listing payment details can only be changed by Guestora payment processing.';
  end if;
  return new;
end;
$$;
drop trigger if exists events_protect_listing_payment on public.events;
create trigger events_protect_listing_payment
before insert or update on public.events
for each row execute function public.protect_event_listing_payment();

create unique index if not exists events_razorpay_listing_order_unique
  on public.events (razorpay_listing_order_id) where razorpay_listing_order_id is not null;
create unique index if not exists events_razorpay_listing_payment_unique
  on public.events (razorpay_listing_payment_id) where razorpay_listing_payment_id is not null;

create or replace function public.require_listing_fee_before_publish()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'published' and new.listing_fee_status is distinct from 'paid' then
    raise exception 'Pay the ₹250 event listing fee before publishing.';
  end if;
  return new;
end;
$$;
drop trigger if exists events_require_listing_fee_before_publish on public.events;
create trigger events_require_listing_fee_before_publish
before insert or update of status, listing_fee_status on public.events
for each row execute function public.require_listing_fee_before_publish();

-- New applications must come from server-side captured-payment finalization.
revoke insert on public.guest_applications from anon, authenticated;
revoke all on function public.save_guest_application_as_guest(uuid,text,text,text) from anon, authenticated;
create or replace function public.require_captured_application_payment()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.payment_status is distinct from 'paid' or new.razorpay_payment_id is null then
    raise exception 'A captured ₹20 application payment is required before submission.';
  end if;
  return new;
end;
$$;
drop trigger if exists guest_applications_require_capture_on_insert on public.guest_applications;
create trigger guest_applications_require_capture_on_insert
before insert on public.guest_applications
for each row execute function public.require_captured_application_payment();
create or replace function public.protect_application_payment_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.role() is distinct from 'service_role' and (
    new.payment_status is distinct from old.payment_status
    or new.application_fee_paise is distinct from old.application_fee_paise
    or new.razorpay_order_id is distinct from old.razorpay_order_id
    or new.razorpay_payment_id is distinct from old.razorpay_payment_id
    or new.razorpay_refund_id is distinct from old.razorpay_refund_id
  ) then
    raise exception 'Payment details can only be changed by Guestora payment processing.';
  end if;
  return new;
end;
$$;
drop trigger if exists guest_applications_protect_payment_fields on public.guest_applications;
create trigger guest_applications_protect_payment_fields
before update on public.guest_applications
for each row execute function public.protect_application_payment_fields();

create table if not exists public.guest_payment_intents (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  guest_id uuid references auth.users(id) on delete set null,
  applicant_data jsonb not null,
  amount_paise integer not null default 2000 check (amount_paise = 2000),
  payment_access_token_hash text,
  razorpay_order_id text unique,
  razorpay_payment_id text unique,
  payment_status text not null default 'pending' check (payment_status in ('pending','failed','authorized','paid')),
  guest_application_id uuid references public.guest_applications(id) on delete set null,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
alter table public.guest_payment_intents enable row level security;
revoke all on public.guest_payment_intents from anon, authenticated;
grant select, insert, update on public.guest_payment_intents to service_role;
grant select, insert, update on public.guest_applications to service_role;
grant select, update on public.events to service_role;

-- Capture processing is idempotent: one intent can create at most one application.
create or replace function public.finalize_paid_guest_application(
  p_intent_id uuid, p_payment_id text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_intent public.guest_payment_intents%rowtype;
  v_event public.events%rowtype;
  v_application public.guest_applications%rowtype;
  v_name text;
  v_email text;
  v_phone text;
begin
  select * into v_intent from public.guest_payment_intents where id = p_intent_id for update;
  if not found then raise exception 'Payment intent not found.'; end if;
  if v_intent.guest_application_id is not null then return v_intent.guest_application_id; end if;
  select * into v_event from public.events where id = v_intent.event_id and status = 'published';
  if not found then raise exception 'This event is not available for applications.'; end if;
  if v_event.application_link_closes_at is not null and now() >= v_event.application_link_closes_at then
    raise exception 'Event guestlist registrations have now been closed.';
  end if;
  v_name := trim(coalesce(v_intent.applicant_data->>'name',''));
  v_email := lower(trim(coalesce(v_intent.applicant_data->>'email','')));
  v_phone := trim(coalesce(v_intent.applicant_data->>'phone',''));
  if length(v_name) < 2 or length(v_email) < 3 or length(regexp_replace(v_phone,'[^0-9]','','g')) not between 8 and 15 then
    raise exception 'Applicant contact details are invalid.';
  end if;
  if exists (select 1 from public.guest_applications ga where ga.event_id=v_event.id and lower(ga.guest_email)=v_email) then
    raise exception 'An application with this email already exists for this event.';
  end if;
  insert into public.guest_applications (
    event_id, guest_id, guest_name, guest_email, guest_phone, status,
    application_fee_paise, payment_status, payment_access_token_hash,
    razorpay_order_id, razorpay_payment_id, check_in_token
  ) values (
    v_event.id, v_intent.guest_id, v_name, v_email, v_phone, 'pending',
    2000, 'paid', v_intent.payment_access_token_hash,
    v_intent.razorpay_order_id, p_payment_id, gen_random_uuid()
  ) returning * into v_application;
  update public.guest_payment_intents set payment_status='paid', razorpay_payment_id=p_payment_id,
    guest_application_id=v_application.id, paid_at=now() where id=v_intent.id;
  return v_application.id;
end;
$$;
revoke all on function public.finalize_paid_guest_application(uuid,text) from public, anon, authenticated;
grant execute on function public.finalize_paid_guest_application(uuid,text) to service_role;

-- Share is exactly 20% of each captured ₹20 fee; transfers wait for Route onboarding.
create table if not exists public.organizer_revenue_shares (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.guest_applications(id) on delete cascade,
  organizer_id uuid not null references auth.users(id) on delete cascade,
  gross_paise integer not null check (gross_paise > 0),
  share_paise integer not null check (share_paise >= 0),
  payout_status text not null default 'pending_route_setup'
    check (payout_status in ('pending_route_setup','ready','transferred','failed','refunded')),
  razorpay_transfer_id text,
  created_at timestamptz not null default now()
);
alter table public.organizer_revenue_shares enable row level security;
revoke all on public.organizer_revenue_shares from anon, authenticated;
grant select, insert, update on public.organizer_revenue_shares to service_role;

create or replace function public.record_organizer_revenue_share()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_organizer uuid;
begin
  if new.payment_status='paid' and (tg_op='INSERT' or old.payment_status is distinct from 'paid') then
    select organizer_id into v_organizer from public.events where id=new.event_id;
    if v_organizer is not null then
      insert into public.organizer_revenue_shares(application_id,organizer_id,gross_paise,share_paise)
      values(new.id,v_organizer,new.application_fee_paise,(new.application_fee_paise * 20 / 100))
      on conflict(application_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guest_applications_record_revenue_share on public.guest_applications;
create trigger guest_applications_record_revenue_share
after insert or update of payment_status on public.guest_applications
for each row execute function public.record_organizer_revenue_share();

create or replace function public.cancel_refunded_organizer_share()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.payment_status='refunded' and old.payment_status is distinct from 'refunded' then
    update public.organizer_revenue_shares set payout_status='refunded'
    where application_id=new.id and payout_status <> 'transferred';
  end if;
  return new;
end;
$$;
drop trigger if exists guest_applications_cancel_refunded_share on public.guest_applications;
create trigger guest_applications_cancel_refunded_share
after update of payment_status on public.guest_applications
for each row execute function public.cancel_refunded_organizer_share();
