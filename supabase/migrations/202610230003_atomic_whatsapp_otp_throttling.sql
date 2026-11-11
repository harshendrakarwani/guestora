-- Serialize OTP rate checks and challenge insertion so concurrent requests
-- cannot race the read-then-insert limits.
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
begin
  if p_phone !~ '^[0-9]{8,15}$' or p_code_hash !~ '^[a-f0-9]{64}$' or p_ip_hash = '' then
    raise exception 'Invalid WhatsApp verification request.';
  end if;

  -- Acquire both locks in stable order to avoid deadlocks when phone and IP
  -- rate limits are contended at the same time.
  for v_lock in
    select lock_key from (values (v_phone_lock), (v_ip_lock)) as locks(lock_key)
    order by lock_key
  loop
    perform pg_advisory_xact_lock(v_lock);
  end loop;

  if exists (
    select 1 from public.whatsapp_otp_challenges
    where event_id = p_event_id and phone = p_phone
      and created_at >= now() - interval '1 minute'
  ) then
    return 'phone_cooldown';
  end if;

  select count(*) into v_phone_count from public.whatsapp_otp_challenges
  where phone = p_phone and created_at >= now() - interval '1 hour';
  select count(*) into v_ip_count from public.whatsapp_otp_challenges
  where request_ip_hash = p_ip_hash and created_at >= now() - interval '1 hour';
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
