-- Payment intents store the authenticated Supabase user ID (auth.users.id).
-- Guest applications must reference the same identity source; profiles rows
-- may be missing for otherwise valid auth users.
alter table public.guest_applications
  drop constraint if exists guest_applications_guest_id_fkey;

alter table public.guest_applications
  add constraint guest_applications_guest_id_fkey
  foreign key (guest_id)
  references auth.users(id)
  on delete set null
  not valid;
