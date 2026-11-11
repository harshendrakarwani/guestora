-- Keep guest email dashboard links reusable until a newer link is requested.
-- A claimed link can refresh its 30-day browser session; replacing a link
-- revokes older links and sessions for that email.
create or replace function public.create_guest_dashboard_email_link(
  p_email text,
  p_phone text,
  p_request_ip_hash text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_lock bigint;
  v_email_count integer;
  v_ip_count integer;
begin
  for v_lock in
    select lock_key from (
      values
        (pg_catalog.hashtextextended('guest-dashboard-email:' || p_email, 0)),
        (pg_catalog.hashtextextended('guest-dashboard-ip:' || p_request_ip_hash, 0))
    ) as locks(lock_key)
    order by lock_key
  loop
    perform pg_catalog.pg_advisory_xact_lock(v_lock);
  end loop;

  delete from public.guest_dashboard_access_links
  where (revoked_at is not null and created_at < v_now - interval '1 day')
     or expires_at < v_now - interval '1 day';

  select count(*) into v_email_count
  from public.guest_dashboard_access_links
  where guest_email = p_email and created_at > v_now - interval '1 hour';

  select count(*) into v_ip_count
  from public.guest_dashboard_access_links
  where request_ip_hash = p_request_ip_hash and created_at > v_now - interval '1 hour';

  if v_email_count >= 3 or v_ip_count >= 10 then
    return false;
  end if;

  update public.guest_dashboard_access_links
  set revoked_at = v_now
  where guest_email = p_email and revoked_at is null;

  insert into public.guest_dashboard_access_links (phone, guest_email, request_ip_hash, token_hash, expires_at)
  values (p_phone, p_email, p_request_ip_hash, p_token_hash, 'infinity'::timestamptz);

  return true;
end;
$$;

create or replace function public.claim_guest_dashboard_access_link(
  p_token_hash text,
  p_session_hash text,
  p_session_expires_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
begin
  update public.guest_dashboard_access_links
  set used_at = now(), session_hash = p_session_hash, session_expires_at = p_session_expires_at
  where token_hash = p_token_hash
    and revoked_at is null
    and expires_at > now()
  returning phone into v_phone;

  return v_phone;
end;
$$;

revoke all on function public.create_guest_dashboard_email_link(text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_guest_dashboard_access_link(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_guest_dashboard_email_link(text, text, text, text, timestamptz) to service_role;
grant execute on function public.claim_guest_dashboard_access_link(text, text, timestamptz) to service_role;

-- Check the event window and apply atomic OTP throttling in one database call,
-- avoiding a separate event lookup round trip on every send-code request.
create or replace function public.create_rate_limited_whatsapp_otp(
  p_event_id uuid,
  p_phone text,
  p_code_hash text,
  p_expires_at timestamptz,
  p_ip_hash text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock bigint;
  v_phone_lock bigint := hashtextextended('otp-phone:' || p_phone, 0);
  v_ip_lock bigint := hashtextextended('otp-ip:' || p_ip_hash, 0);
  v_phone_count integer;
  v_ip_count integer;
  v_challenge_id uuid;
  v_event public.events%rowtype;
  v_now timestamptz := now();
begin
  if p_phone !~ '^[0-9]{8,15}$' or p_code_hash !~ '^[a-f0-9]{64}$' or p_ip_hash = '' then
    raise exception 'Invalid WhatsApp verification request.';
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found or v_event.status <> 'published' or v_event.listing_fee_status <> 'paid' then
    return 'event_unavailable';
  end if;
  if v_event.application_opens_at is not null and v_now < v_event.application_opens_at then
    return 'event_not_open:' || v_event.application_opens_at::text;
  end if;
  if v_event.application_link_closes_at is not null and v_now >= v_event.application_link_closes_at then
    return 'event_closed';
  end if;

  for v_lock in
    select lock_key from (values (v_phone_lock), (v_ip_lock)) as locks(lock_key)
    order by lock_key
  loop
    perform pg_advisory_xact_lock(v_lock);
  end loop;

  if exists (
    select 1 from public.whatsapp_otp_challenges
    where event_id = p_event_id and phone = p_phone
      and created_at >= v_now - interval '1 minute'
  ) then
    return 'phone_cooldown';
  end if;

  select count(*) into v_phone_count from public.whatsapp_otp_challenges
  where phone = p_phone and created_at >= v_now - interval '1 hour';
  select count(*) into v_ip_count from public.whatsapp_otp_challenges
  where request_ip_hash = p_ip_hash and created_at >= v_now - interval '1 hour';
  if v_phone_count >= 5 or v_ip_count >= 8 then return 'rate_limited'; end if;

  insert into public.whatsapp_otp_challenges(event_id, phone, code_hash, expires_at, request_ip_hash)
  values (p_event_id, p_phone, p_code_hash, p_expires_at, p_ip_hash)
  returning id into v_challenge_id;
  return v_challenge_id::text;
end;
$$;

revoke all on function public.create_rate_limited_whatsapp_otp(uuid, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.create_rate_limited_whatsapp_otp(uuid, text, text, timestamptz, text)
  to service_role;
