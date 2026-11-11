-- Prevent duplicate applications for an event when either the contact email
-- or verified WhatsApp number has already been used. The name is not part of
-- the duplicate identity.
create or replace function public.find_duplicate_guest_application(
  p_event_id uuid,
  p_guest_email text,
  p_guest_phone text
) returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ga.id
  from public.guest_applications ga
  where ga.event_id = p_event_id
    and (
      lower(trim(coalesce(ga.guest_email, ''))) = lower(trim(coalesce(p_guest_email, '')))
      or regexp_replace(coalesce(ga.guest_phone, ''), '[^0-9]', '', 'g') =
         regexp_replace(coalesce(p_guest_phone, ''), '[^0-9]', '', 'g')
    )
  limit 1;
$$;
revoke all on function public.find_duplicate_guest_application(uuid, text, text) from public, anon, authenticated;
grant execute on function public.find_duplicate_guest_application(uuid, text, text) to service_role;

-- Serialize phone matches too. The existing email trigger serializes active
-- checkouts by email; this trigger adds the verified WhatsApp number guard.
create or replace function public.prevent_duplicate_guest_phone_checkout()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_phone text := regexp_replace(coalesce(new.applicant_data->>'phone', ''), '[^0-9]', '', 'g');
begin
  if new.payment_status not in ('pending', 'authorized') or v_phone = '' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.event_id::text || ':phone:' || v_phone, 0));

  if exists (
    select 1
    from public.guest_applications ga
    where ga.event_id = new.event_id
      and regexp_replace(coalesce(ga.guest_phone, ''), '[^0-9]', '', 'g') = v_phone
  ) then
    raise exception using
      errcode = '23505',
      message = 'An application using this WhatsApp number already exists for this event.';
  end if;

  if exists (
    select 1
    from public.guest_payment_intents existing
    where existing.event_id = new.event_id
      and regexp_replace(coalesce(existing.applicant_data->>'phone', ''), '[^0-9]', '', 'g') = v_phone
      and existing.payment_status in ('pending', 'authorized')
      and existing.id is distinct from new.id
  ) then
    raise exception using
      errcode = '23505',
      message = 'A checkout using this WhatsApp number is already active for this event.';
  end if;

  return new;
end;
$$;

drop trigger if exists guest_payment_intents_prevent_duplicate_identity on public.guest_payment_intents;
drop trigger if exists guest_payment_intents_prevent_duplicate_phone on public.guest_payment_intents;
create trigger guest_payment_intents_prevent_duplicate_phone
before insert or update of event_id, applicant_data, payment_status
on public.guest_payment_intents
for each row
execute function public.prevent_duplicate_guest_phone_checkout();

-- Recheck the contact identity in the captured-payment finalizer so webhook
-- and concurrent payment paths cannot create a second application.
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
  v_phone_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
  if length(v_name) < 2 or length(v_email) < 3 or length(v_phone_digits) not between 8 and 15 then
    raise exception 'Applicant contact details are invalid.';
  end if;

  -- Always lock email then phone so parallel requests for either contact
  -- value are serialized without deadlocks.
  perform pg_advisory_xact_lock(hashtextextended(v_event.id::text || ':' || v_email, 0));
  perform pg_advisory_xact_lock(hashtextextended(v_event.id::text || ':phone:' || v_phone_digits, 0));

  if exists (
    select 1 from public.guest_applications ga
    where ga.event_id = v_event.id
      and (
        lower(trim(coalesce(ga.guest_email, ''))) = v_email
        or regexp_replace(coalesce(ga.guest_phone, ''), '[^0-9]', '', 'g') = v_phone_digits
      )
  ) then
    raise exception 'A duplicate application already exists for this event using this email or WhatsApp number.';
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
