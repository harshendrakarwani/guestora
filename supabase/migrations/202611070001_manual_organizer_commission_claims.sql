-- Manual organizer commission claims. Payout destinations are encrypted by the
-- application before storage; they are never included in notification emails.
alter table public.organizer_commission_claims
  drop constraint if exists organizer_commission_claims_status_check;

alter table public.organizer_commission_claims
  add constraint organizer_commission_claims_status_check check (
    status in (
      'creating', 'issued', 'processing', 'processed', 'failed', 'cancelled',
      'pending_manual_payment', 'manual_processing', 'paid', 'rejected'
    )
  );

alter table public.organizer_commission_claims
  add column if not exists payout_method text,
  add column if not exists payout_details_ciphertext text,
  add column if not exists organizer_email text,
  add column if not exists notification_status text not null default 'not_required',
  add column if not exists manual_payment_reference text,
  add column if not exists paid_at timestamptz,
  add column if not exists reviewed_at timestamptz;

alter table public.organizer_commission_claims
  drop constraint if exists organizer_commission_claims_payout_method_check;
alter table public.organizer_commission_claims
  add constraint organizer_commission_claims_payout_method_check
  check (payout_method is null or payout_method in ('upi', 'bank'));

alter table public.organizer_commission_claims
  drop constraint if exists organizer_commission_claims_notification_status_check;
alter table public.organizer_commission_claims
  add constraint organizer_commission_claims_notification_status_check
  check (notification_status in ('not_required', 'pending', 'sent', 'failed'));

create index if not exists organizer_commission_claims_manual_queue_idx
  on public.organizer_commission_claims (status, created_at desc)
  where status in ('pending_manual_payment', 'manual_processing');

-- The only path for payout completion is a service-role call after an admin
-- records a manual transfer. This keeps the claim and ledger update atomic.
create or replace function public.update_manual_organizer_commission_claim(
  p_claim_id uuid,
  p_next_status text,
  p_payment_reference text default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.organizer_commission_claims%rowtype;
begin
  if p_next_status not in ('manual_processing', 'paid', 'rejected') then
    raise exception 'Invalid manual commission claim status.';
  end if;

  select * into v_claim
  from public.organizer_commission_claims
  where id = p_claim_id
  for update;
  if not found then return false; end if;

  if p_next_status = 'manual_processing' then
    if v_claim.status <> 'pending_manual_payment' then return false; end if;
    update public.organizer_commission_claims
    set status = p_next_status, reviewed_at = now(), updated_at = now()
    where id = p_claim_id;
    return true;
  end if;

  if p_next_status = 'rejected' then
    if v_claim.status <> 'pending_manual_payment' then return false; end if;
    update public.organizer_commission_claims
    set status = p_next_status, payout_details_ciphertext = null,
        reviewed_at = now(), updated_at = now()
    where id = p_claim_id;
    return true;
  end if;

  if v_claim.status not in ('pending_manual_payment', 'manual_processing') then return false; end if;
  if nullif(trim(coalesce(p_payment_reference, '')), '') is null then
    raise exception 'Enter the bank or UPI transaction reference before marking the claim paid.';
  end if;

  update public.organizer_commission_claims
  set status = 'paid',
      payout_details_ciphertext = null,
      manual_payment_reference = left(trim(p_payment_reference), 100),
      paid_at = now(), reviewed_at = coalesce(reviewed_at, now()), updated_at = now()
  where id = p_claim_id;

  update public.organizer_revenue_shares
  set payout_status = 'transferred'
  where organizer_id = v_claim.organizer_id
    and application_id in (
      select id from public.guest_applications where event_id = v_claim.event_id
    )
    and payout_status in ('pending_route_setup', 'ready');

  return true;
end;
$$;

revoke all on function public.update_manual_organizer_commission_claim(uuid, text, text) from public, anon, authenticated;
grant execute on function public.update_manual_organizer_commission_claim(uuid, text, text) to service_role;
