create table if not exists public.whatsapp_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  phone text not null check (phone ~ '^[0-9]{8,15}$'),
  code_hash text not null,
  request_ip_hash text not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verified_at timestamptz,
  consumed_at timestamptz
);

create index if not exists whatsapp_otp_challenges_phone_created_idx
  on public.whatsapp_otp_challenges (phone, created_at desc);
create index if not exists whatsapp_otp_challenges_ip_created_idx
  on public.whatsapp_otp_challenges (request_ip_hash, created_at desc);
create index if not exists whatsapp_otp_challenges_event_phone_created_idx
  on public.whatsapp_otp_challenges (event_id, phone, created_at desc);

alter table public.whatsapp_otp_challenges enable row level security;
revoke all on public.whatsapp_otp_challenges from anon, authenticated;
grant all on public.whatsapp_otp_challenges to service_role;

-- Prevent any server-side payment finalizer from creating an application
-- unless the payment intent was created after WhatsApp number verification.
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
begin
  select * into v_intent
  from public.guest_payment_intents
  where id = p_intent_id
  for update;
  if not found then raise exception 'Payment intent not found.'; end if;
  if v_intent.guest_application_id is not null then return v_intent.guest_application_id; end if;
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
  if length(v_name) < 2 or length(v_email) < 3 or length(regexp_replace(v_phone, '[^0-9]', '', 'g')) not between 8 and 15 then
    raise exception 'Applicant contact details are invalid.';
  end if;
  if exists (select 1 from public.guest_applications ga where ga.event_id = v_event.id and lower(ga.guest_email) = v_email) then
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

  update public.guest_payment_intents
  set payment_status = 'paid', razorpay_payment_id = p_payment_id,
      guest_application_id = v_application.id, paid_at = now()
  where id = v_intent.id;
  return v_application.id;
end;
$$;

revoke all on function public.finalize_paid_guest_application(uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_paid_guest_application(uuid, text) to service_role;
