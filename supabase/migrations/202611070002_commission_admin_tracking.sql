-- Let the allowlisted server admin record a commission that was already paid
-- outside Guestora (including events without an organizer-submitted claim).
-- The claim and per-application ledger are updated in one transaction.
create or replace function public.record_manual_organizer_commission_payment(
  p_event_id uuid,
  p_payment_reference text,
  p_paid_at timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_claim public.organizer_commission_claims%rowtype;
  v_claim_id uuid;
  v_amount integer;
  v_email text;
begin
  if nullif(trim(coalesce(p_payment_reference, '')), '') is null then
    raise exception 'Enter the bank or UPI transaction reference.';
  end if;
  if p_paid_at is null or p_paid_at > now() + interval '1 minute' then
    raise exception 'Enter a valid payment date and time.';
  end if;

  select * into v_event from public.events where id = p_event_id for update;
  if not found then return null; end if;
  if v_event.entry_closed_at is null and (v_event.entry_deadline is null or v_event.entry_deadline > now()) then
    raise exception 'Close guest-list entry before recording event commission.';
  end if;
  if exists (select 1 from public.guest_applications where event_id = p_event_id and status = 'pending') then
    raise exception 'Review all event applications before recording commission.';
  end if;

  select coalesce(sum(share_paise), 0)::integer into v_amount
  from public.organizer_revenue_shares s
  join public.guest_applications a on a.id = s.application_id
  where a.event_id = p_event_id and s.organizer_id = v_event.organizer_id
    and a.payment_status = 'paid' and a.status <> 'rejected'
    and s.payout_status in ('pending_route_setup', 'ready');
  if v_amount <= 0 then return null; end if;

  select * into v_claim from public.organizer_commission_claims
  where event_id = p_event_id and organizer_id = v_event.organizer_id
  for update;

  if found then
    if v_claim.status = 'paid' or v_claim.status not in
      ('pending_manual_payment', 'manual_processing', 'rejected', 'failed', 'cancelled') then
      return null;
    end if;
    v_claim_id := v_claim.id;
    update public.organizer_commission_claims
    set amount_paise = v_amount,
        status = 'paid',
        payout_details_ciphertext = null,
        manual_payment_reference = left(trim(p_payment_reference), 100),
        paid_at = p_paid_at,
        reviewed_at = coalesce(reviewed_at, now()),
        updated_at = now()
    where id = v_claim_id;
  else
    select email into v_email from auth.users where id = v_event.organizer_id;
    insert into public.organizer_commission_claims (
      event_id, organizer_id, organizer_email, amount_paise, status,
      manual_payment_reference, paid_at, reviewed_at, notification_status
    ) values (
      p_event_id, v_event.organizer_id, v_email, v_amount, 'paid',
      left(trim(p_payment_reference), 100), p_paid_at, now(), 'not_required'
    ) returning id into v_claim_id;
  end if;

  update public.organizer_revenue_shares s
  set payout_status = 'transferred'
  from public.guest_applications a
  where a.id = s.application_id and a.event_id = p_event_id
    and s.organizer_id = v_event.organizer_id
    and a.payment_status = 'paid' and a.status <> 'rejected'
    and s.payout_status in ('pending_route_setup', 'ready');

  return v_claim_id;
end;
$$;

revoke all on function public.record_manual_organizer_commission_payment(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_manual_organizer_commission_payment(uuid, text, timestamptz) to service_role;

-- Keep normal payout-queue completion aligned with the event-summary rule:
-- rejected guests do not earn organizer commission while refunds are pending.
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
  select * into v_claim from public.organizer_commission_claims where id = p_claim_id for update;
  if not found then return false; end if;

  if p_next_status = 'manual_processing' then
    if v_claim.status <> 'pending_manual_payment' then return false; end if;
    update public.organizer_commission_claims set status = p_next_status, reviewed_at = now(), updated_at = now() where id = p_claim_id;
    return true;
  end if;
  if p_next_status = 'rejected' then
    if v_claim.status <> 'pending_manual_payment' then return false; end if;
    update public.organizer_commission_claims set status = p_next_status, payout_details_ciphertext = null,
      reviewed_at = now(), updated_at = now() where id = p_claim_id;
    return true;
  end if;
  if v_claim.status not in ('pending_manual_payment', 'manual_processing') then return false; end if;
  if nullif(trim(coalesce(p_payment_reference, '')), '') is null then
    raise exception 'Enter the bank or UPI transaction reference before marking the claim paid.';
  end if;

  update public.organizer_commission_claims set status = 'paid', payout_details_ciphertext = null,
    manual_payment_reference = left(trim(p_payment_reference), 100), paid_at = now(),
    reviewed_at = coalesce(reviewed_at, now()), updated_at = now() where id = p_claim_id;
  update public.organizer_revenue_shares s set payout_status = 'transferred'
  from public.guest_applications a
  where a.id = s.application_id and a.event_id = v_claim.event_id
    and s.organizer_id = v_claim.organizer_id and a.payment_status = 'paid' and a.status <> 'rejected'
    and s.payout_status in ('pending_route_setup', 'ready');
  return true;
end;
$$;

revoke all on function public.update_manual_organizer_commission_claim(uuid, text, text) from public, anon, authenticated;
grant execute on function public.update_manual_organizer_commission_claim(uuid, text, text) to service_role;
