alter table public.guest_dashboard_access_links
  add column if not exists guest_email text;

create index if not exists guest_dashboard_access_email_created_idx
  on public.guest_dashboard_access_links (guest_email, created_at desc)
  where guest_email is not null;

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
  v_email_count integer;
  v_ip_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest-dashboard-email:' || p_email, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest-dashboard-ip:' || p_request_ip_hash, 0));

  delete from public.guest_dashboard_access_links
  where coalesce(session_expires_at, expires_at) < v_now - interval '1 day';

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
  where guest_email = p_email and revoked_at is null and session_hash is null;

  insert into public.guest_dashboard_access_links (phone, guest_email, request_ip_hash, token_hash, expires_at)
  values (p_phone, p_email, p_request_ip_hash, p_token_hash, p_expires_at);

  return true;
end;
$$;

revoke all on function public.create_guest_dashboard_email_link(text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_guest_dashboard_email_link(text, text, text, text, timestamptz) to service_role;
