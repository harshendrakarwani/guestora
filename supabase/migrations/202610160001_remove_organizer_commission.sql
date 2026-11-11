-- Stop calculating organizer commission or payout amounts.
-- Keep any historical ledger rows for reference; no new rows will be created.
drop trigger if exists guest_applications_record_revenue_share
  on public.guest_applications;
drop trigger if exists guest_applications_cancel_refunded_share
  on public.guest_applications;

drop function if exists public.record_organizer_revenue_share();
drop function if exists public.cancel_refunded_organizer_share();
