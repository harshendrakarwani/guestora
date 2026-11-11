-- Add Indian state/UT to event locations and allow visitors to read only
-- published listings from the public events page.

alter table public.events
  add column if not exists state text;

grant select (
  id,
  title,
  venue_name,
  city,
  state,
  description,
  capacity,
  application_closes_at,
  created_at,
  status
) on table public.events to anon;

drop policy if exists "Anyone can view published events" on public.events;
create policy "Anyone can view published events"
  on public.events
  for select
  to anon
  using (status = 'published');
