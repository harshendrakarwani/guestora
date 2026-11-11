-- A submitted application exists only after a confirmed payment. Ignore old
-- unpaid placeholder rows, while applying the email rule across account and
-- guest applications alike.

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
    and lower(trim(coalesce(ga.guest_email, ''))) = lower(trim(coalesce(p_guest_email, '')))
    and ga.payment_status in ('paid', 'refund_processing', 'refund_pending', 'refunded')
  order by ga.created_at desc
  limit 1;
$$;

revoke all on function public.find_duplicate_guest_application(uuid, text, text) from public, anon, authenticated;
grant execute on function public.find_duplicate_guest_application(uuid, text, text) to service_role;

-- The original anonymous-email index also covered unpaid legacy placeholder
-- applications. Keep uniqueness only for actual submissions.
drop index if exists public.guest_applications_anonymous_email_per_event;
create unique index guest_applications_anonymous_submitted_email_per_event
  on public.guest_applications (event_id, lower(trim(guest_email)))
  where guest_id is null
    and guest_email is not null
    and payment_status in ('paid', 'refund_processing', 'refund_pending', 'refunded');

-- Recheck under the event/email lock at capture time so two simultaneous
-- payment confirmations cannot submit the same email. Old unpaid rows do not
-- prevent a new paid submission.
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

  -- Shared WhatsApp numbers are allowed; serialize application submissions by
  -- event and normalized email across both account and guest applications.
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
    v_instagram, v_avatar_url, 'pending', 2000, 'paid',
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
