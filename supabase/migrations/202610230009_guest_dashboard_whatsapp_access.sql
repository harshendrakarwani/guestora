create table if not exists public.guest_dashboard_access_links (
  id uuid primary key default gen_random_uuid(),
  phone text not null check (phone ~ '^[0-9]{8,15}$'),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  request_ip_hash text not null check (request_ip_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  session_hash text unique check (session_hash is null or session_hash ~ '^[a-f0-9]{64}$'),
  session_expires_at timestamptz
);

create index if not exists guest_dashboard_access_phone_created_idx
  on public.guest_dashboard_access_links (phone, created_at desc);
create index if not exists guest_dashboard_access_ip_created_idx
  on public.guest_dashboard_access_links (request_ip_hash, created_at desc);
create index if not exists guest_dashboard_access_expiry_idx
  on public.guest_dashboard_access_links (expires_at);
create index if not exists guest_applications_guest_phone_guest_mode_idx
  on public.guest_applications (guest_phone)
  where guest_id is null;

alter table public.guest_dashboard_access_links enable row level security;
revoke all on public.guest_dashboard_access_links from anon, authenticated;
grant select, insert, update, delete on public.guest_dashboard_access_links to service_role;

create or replace function public.create_guest_dashboard_access_link(
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
  v_phone_count integer;
  v_ip_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest-dashboard:' || p_phone, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest-dashboard-ip:' || p_request_ip_hash, 0));

  delete from public.guest_dashboard_access_links
  where coalesce(session_expires_at, expires_at) < v_now - interval '1 day';

  select count(*) into v_phone_count
  from public.guest_dashboard_access_links
  where phone = p_phone and created_at > v_now - interval '1 hour';

  select count(*) into v_ip_count
  from public.guest_dashboard_access_links
  where request_ip_hash = p_request_ip_hash and created_at > v_now - interval '1 hour';

  if v_phone_count >= 3 or v_ip_count >= 10 then
    return false;
  end if;

  update public.guest_dashboard_access_links
  set revoked_at = v_now
  where phone = p_phone and revoked_at is null and session_hash is null;

  insert into public.guest_dashboard_access_links (phone, request_ip_hash, token_hash, expires_at)
  values (p_phone, p_request_ip_hash, p_token_hash, p_expires_at);

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
    and used_at is null
    and revoked_at is null
    and expires_at > now()
  returning phone into v_phone;

  return v_phone;
end;
$$;

revoke all on function public.create_guest_dashboard_access_link(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_guest_dashboard_access_link(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_guest_dashboard_access_link(text, text, text, timestamptz) to service_role;
grant execute on function public.claim_guest_dashboard_access_link(text, text, timestamptz) to service_role;
