-- New guest applications cost ₹30. Existing in-flight ₹20 checkouts remain
-- valid so a guest is never charged twice or forced to abandon an old order.
alter table public.guest_payment_intents
  alter column amount_paise set default 3000;

alter table public.guest_payment_intents
  drop constraint if exists guest_payment_intents_amount_paise_check;

alter table public.guest_payment_intents
  add constraint guest_payment_intents_amount_paise_check
  check (amount_paise in (2000, 3000));

create or replace function public.finalize_paid_guest_application(
  p_intent_id uuid,
  p_payment_id text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.guest_payment_intents%rowtype;
  v_event public.events%rowtype;
  v_application public.guest_applications%rowtype;
  v_name text;
  v_email text;
  v_phone text;
  v_phone_digits text;
  v_instagram text;
  v_avatar_url text;
begin
  select * into v_intent
  from public.guest_payment_intents
  where id = p_intent_id
  for update;
  if not found then raise exception 'Payment intent not found.'; end if;
  if v_intent.guest_application_id is not null then return v_intent.guest_application_id; end if;
  if v_intent.amount_paise not in (2000, 3000) then
    raise exception 'The application fee amount is not supported.';
  end if;
  if nullif(v_intent.applicant_data->>'whatsapp_verified_at', '') is null then
    raise exception 'Verify the WhatsApp number before submitting this application.';
  end if;

  select * into v_event
  from public.events
  where id = v_intent.event_id and status = 'published';
  if not found then raise exception 'This event is not available for applications.'; end if;
  if v_event.application_opens_at is not null and now() < v_event.application_opens_at then
    raise exception 'Guest list registration has not opened yet.';
  end if;
  if v_event.application_link_closes_at is not null and now() >= v_event.application_link_closes_at then
    raise exception 'Event guestlist registrations have now been closed.';
  end if;

  v_name := trim(coalesce(v_intent.applicant_data->>'name', ''));
  v_email := lower(trim(coalesce(v_intent.applicant_data->>'email', '')));
  v_phone := trim(coalesce(v_intent.applicant_data->>'phone', ''));
  v_phone_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
  v_instagram := nullif(regexp_replace(trim(coalesce(v_intent.applicant_data->>'instagram_username', '')), '^@', ''), '');
  v_avatar_url := nullif(trim(coalesce(v_intent.applicant_data->>'avatar_url', '')), '');

  if length(v_name) < 2 or length(v_email) < 3 or length(v_phone_digits) not between 8 and 15 then
    raise exception 'Applicant contact details are invalid.';
  end if;
  if v_instagram is not null and (length(v_instagram) > 30 or v_instagram !~ '^[A-Za-z0-9._]+$') then
    raise exception 'Instagram username is invalid.';
  end if;
  if v_avatar_url is not null and v_avatar_url !~ '^https://[^/]+/storage/v1/object/public/guest-avatars/' then
    v_avatar_url := null;
  end if;

  -- Same WhatsApp number is allowed; serialize by event and normalized email.
  perform pg_advisory_xact_lock(hashtextextended(v_event.id::text || ':' || v_email, 0));
  if exists (
    select 1 from public.guest_applications ga
    where ga.event_id = v_event.id
      and lower(trim(coalesce(ga.guest_email, ''))) = v_email
      and ga.payment_status in ('paid', 'refund_processing', 'refund_pending', 'refunded')
  ) then
    raise exception 'An application with the same email has already been submitted.';
  end if;

  insert into public.guest_applications (
    event_id, guest_id, guest_name, guest_email, guest_phone,
    instagram_username, guest_avatar_url, status, application_fee_paise,
    payment_status, payment_access_token_hash, razorpay_order_id,
    razorpay_payment_id, check_in_token
  ) values (
    v_event.id, v_intent.guest_id, v_name, v_email, v_phone,
    v_instagram, v_avatar_url, 'pending', v_intent.amount_paise, 'paid',
    v_intent.payment_access_token_hash, v_intent.razorpay_order_id,
    p_payment_id, gen_random_uuid()
  ) returning * into v_application;

  update public.guest_payment_intents
  set payment_status = 'paid', razorpay_payment_id = p_payment_id,
      guest_application_id = v_application.id, paid_at = now()
  where id = v_intent.id;
  return v_application.id;
end;
$$;

revoke all on function public.finalize_paid_guest_application(uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_paid_guest_application(uuid, text) to service_role;

-- Commission is 40% of the gross application fee (₹12 on a ₹30 application).
-- The ledger stays per application for audit/reconciliation.
create or replace function public.record_organizer_revenue_share()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organizer uuid;
begin
  if new.payment_status = 'paid' and (tg_op = 'INSERT' or old.payment_status is distinct from 'paid') then
    select organizer_id into v_organizer from public.events where id = new.event_id;
    if v_organizer is not null then
      insert into public.organizer_revenue_shares (
        application_id, organizer_id, gross_paise, share_paise, payout_status
      ) values (
        new.id, v_organizer, new.application_fee_paise,
        floor(new.application_fee_paise * 0.40)::integer, 'pending_route_setup'
      )
      on conflict (application_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

-- Recalculate unpaid historical shares to the newly agreed 40% rate.
update public.organizer_revenue_shares
set share_paise = floor(gross_paise * 0.40)::integer
where payout_status not in ('transferred', 'refunded');

-- One claim per event. The organizer receives a RazorpayX Payout Link and
-- chooses a bank account or UPI ID on Razorpay's hosted page. We never store
-- their bank details in Guestora.
create table if not exists public.organizer_commission_claims (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  organizer_id uuid not null references auth.users(id) on delete cascade,
  amount_paise integer not null check (amount_paise > 0),
  status text not null default 'creating'
    check (status in ('creating', 'issued', 'processing', 'processed', 'failed', 'cancelled')),
  razorpay_payout_link_id text unique,
  payout_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, organizer_id)
);
alter table public.organizer_commission_claims enable row level security;
revoke all on public.organizer_commission_claims from anon, authenticated;
grant select, insert, update on public.organizer_commission_claims to service_role;
create index if not exists organizer_commission_claims_organizer_created_idx
  on public.organizer_commission_claims (organizer_id, created_at desc);

drop trigger if exists guest_applications_record_revenue_share on public.guest_applications;
create trigger guest_applications_record_revenue_share
after insert or update of payment_status on public.guest_applications
for each row execute function public.record_organizer_revenue_share();

create or replace function public.cancel_refunded_organizer_share()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_status = 'refunded' and old.payment_status is distinct from 'refunded' then
    update public.organizer_revenue_shares
    set payout_status = 'refunded'
    where application_id = new.id
      and payout_status <> 'transferred';
  end if;
  return new;
end;
$$;

drop trigger if exists guest_applications_cancel_refunded_share on public.guest_applications;
create trigger guest_applications_cancel_refunded_share
after update of payment_status on public.guest_applications
for each row execute function public.cancel_refunded_organizer_share();
