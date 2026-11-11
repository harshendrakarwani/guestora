-- Let guests apply with contact details without creating a Guestora account.
alter table public.guest_applications
  add column if not exists guest_name text;

alter table public.guest_applications
  alter column guest_id drop not null;

alter table public.guest_applications
  alter column check_in_token set default gen_random_uuid();

create unique index if not exists guest_applications_anonymous_email_per_event
  on public.guest_applications (event_id, lower(guest_email))
  where guest_id is null and guest_email is not null;

create or replace function public.save_guest_application_as_guest(
  p_event_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text
)
returns table (application_id uuid, application_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_application public.guest_applications%rowtype;
  v_email text := lower(trim(coalesce(p_guest_email, '')));
  v_name text := trim(coalesce(p_guest_name, ''));
  v_phone text := trim(coalesce(p_guest_phone, ''));
begin
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Enter your name (2 to 120 characters).';
  end if;
  if length(v_email) > 254 or v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Enter a valid email address.';
  end if;
  if length(regexp_replace(v_phone, '[^0-9]', '', 'g')) not between 8 and 15 then
    raise exception 'Enter a valid WhatsApp number with country code.';
  end if;

  -- Lock the event row so simultaneous requests cannot bypass duplicate checks.
  select * into v_event
  from public.events e
  where e.id = p_event_id and e.status = 'published'
  for update;
  if not found then
    raise exception 'This event is not available for applications.';
  end if;
  if v_event.application_link_closes_at is not null
     and now() >= v_event.application_link_closes_at then
    raise exception 'Event guestlist registrations have now been closed.';
  end if;

  if exists (
    select 1 from public.guest_applications ga
    where ga.event_id = p_event_id
      and ga.guest_id is null
      and lower(ga.guest_email) = v_email
  ) then
    raise exception 'An application with this email already exists for this event.';
  end if;

  insert into public.guest_applications (
    event_id,
    guest_id,
    guest_name,
    guest_email,
    guest_phone,
    status,
    application_fee_paise,
    payment_status,
    check_in_token
  ) values (
    p_event_id,
    null,
    v_name,
    v_email,
    v_phone,
    'pending',
    2000,
    'pending',
    gen_random_uuid()
  )
  returning * into v_application;

  return query select v_application.id, v_application.status::text;
end;
$$;

revoke all on function public.save_guest_application_as_guest(uuid, text, text, text) from public;
grant execute on function public.save_guest_application_as_guest(uuid, text, text, text) to anon, authenticated;
