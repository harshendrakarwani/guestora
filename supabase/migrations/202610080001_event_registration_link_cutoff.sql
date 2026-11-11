-- Give organizers a separate cutoff for the public registration link.
alter table public.events
  add column if not exists application_link_closes_at timestamptz;

-- Public event detail pages read this field to switch to the closed message.
grant select (application_link_closes_at)
  on table public.events to anon;

-- Prevent a direct RPC/API call from creating or changing an application after
-- the organizer's registration-link cutoff has passed.
create or replace function public.enforce_event_registration_link_cutoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.events e
    where e.id = new.event_id
      and e.application_link_closes_at is not null
      and now() >= e.application_link_closes_at
  ) then
    raise exception 'Event guestlist registrations have now been closed.';
  end if;

  return new;
end;
$$;

drop trigger if exists guest_applications_registration_link_cutoff
  on public.guest_applications;

create trigger guest_applications_registration_link_cutoff
before insert or update of guest_phone on public.guest_applications
for each row
execute function public.enforce_event_registration_link_cutoff();
