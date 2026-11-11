-- Serialize payment intent creation per event and email. This prevents two
-- concurrent requests from creating separate active Razorpay checkouts.
create or replace function public.prevent_duplicate_active_guest_payment_intent()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(new.applicant_data->>'email', '')));
begin
  if new.payment_status not in ('pending', 'authorized') or v_email = '' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.event_id::text || ':' || v_email, 0));

  if exists (
    select 1
    from public.guest_payment_intents existing
    where existing.event_id = new.event_id
      and lower(trim(coalesce(existing.applicant_data->>'email', ''))) = v_email
      and existing.payment_status in ('pending', 'authorized')
      and existing.id is distinct from new.id
  ) then
    raise exception using
      errcode = '23505',
      message = 'An active checkout already exists for this event and email.';
  end if;

  return new;
end;
$$;

drop trigger if exists guest_payment_intents_prevent_duplicate_active on public.guest_payment_intents;
create trigger guest_payment_intents_prevent_duplicate_active
before insert or update of event_id, applicant_data, payment_status
on public.guest_payment_intents
for each row
execute function public.prevent_duplicate_active_guest_payment_intent();
