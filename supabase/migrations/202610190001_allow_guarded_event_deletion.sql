-- The organizer API validates ownership, draft status, and related payment/application records
-- before deleting. Grant only the server role the table privilege needed by that endpoint.
grant delete on table public.events to service_role;
