-- Return the original check-in time when the same QR is scanned again.
create or replace function public.check_in_guest_by_token(
  p_check_in_token uuid,
  p_approve_anyway boolean
)
returns table (
  guest_email text,
  event_title text,
  checked_in_at timestamptz,
  entry_closes_at timestamptz,
  requires_override boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application public.guest_applications%rowtype;
  v_event public.events%rowtype;
  v_checked_in_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sign in with the event organizer account to check in guests.';
  end if;

  select * into v_application
  from public.guest_applications ga
  where ga.check_in_token = p_check_in_token;

  if not found then
    raise exception 'This Guestora QR code is not valid.';
  end if;

  select * into v_event
  from public.events e
  where e.id = v_application.event_id;

  if not found or v_event.organizer_id <> auth.uid() then
    raise exception 'This guest belongs to a different organizer.';
  end if;

  if v_application.status <> 'approved' then
    raise exception 'Only approved guests can be checked in.';
  end if;

  if v_application.checked_in_at is not null then
    raise exception 'This QR has already been scanned at %.',
      to_char(v_application.checked_in_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI:SS AM');
  end if;

  if v_event.entry_starts_at is not null and now() < v_event.entry_starts_at then
    raise exception 'Check-in for this event has not opened yet.';
  end if;

  if v_event.entry_deadline is not null
     and now() >= v_event.entry_deadline
     and not coalesce(p_approve_anyway, false) then
    return query
    select v_application.guest_email, v_event.title, null::timestamptz,
      v_event.entry_deadline, true;
    return;
  end if;

  update public.guest_applications ga
  set checked_in_at = now()
  where ga.id = v_application.id
    and ga.checked_in_at is null
  returning ga.checked_in_at into v_checked_in_at;

  if v_checked_in_at is null then
    select ga.checked_in_at into v_checked_in_at
    from public.guest_applications ga
    where ga.id = v_application.id;

    raise exception 'This QR has already been scanned at %.',
      coalesce(
        to_char(v_checked_in_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI:SS AM'),
        'an unknown time'
      );
  end if;

  return query
  select v_application.guest_email, v_event.title, v_checked_in_at,
    v_event.entry_deadline, false;
end;
$$;

revoke all on function public.check_in_guest_by_token(uuid, boolean) from public;
grant execute on function public.check_in_guest_by_token(uuid, boolean) to authenticated;
