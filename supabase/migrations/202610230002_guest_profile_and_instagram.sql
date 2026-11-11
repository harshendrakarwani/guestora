-- Guest profile photos are stored under the owning user's folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guest-avatars', 'guest-avatars', true, 3145728, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Guest avatars are publicly readable" on storage.objects;
create policy "Guest avatars are publicly readable"
on storage.objects for select
using (bucket_id = 'guest-avatars');

drop policy if exists "Guests can upload their own avatar" on storage.objects;
create policy "Guests can upload their own avatar"
on storage.objects for insert to authenticated
with check (bucket_id = 'guest-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Guests can update their own avatar" on storage.objects;
create policy "Guests can update their own avatar"
on storage.objects for update to authenticated
using (bucket_id = 'guest-avatars' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'guest-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Guests can delete their own avatar" on storage.objects;
create policy "Guests can delete their own avatar"
on storage.objects for delete to authenticated
using (bucket_id = 'guest-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

alter table public.guest_applications
  add column if not exists instagram_username text;
alter table public.guest_applications
  add column if not exists guest_avatar_url text;

alter table public.guest_applications
  drop constraint if exists guest_applications_instagram_username_length;
alter table public.guest_applications
  add constraint guest_applications_instagram_username_length
  check (instagram_username is null or length(instagram_username) <= 30);

-- Preserve the existing payment, date-window, and duplicate checks while
-- copying the optional Instagram username from the captured payment intent.
create or replace function public.finalize_paid_guest_application(
  p_intent_id uuid,
  p_payment_id text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.guest_payment_intents%rowtype;
  v_event public.events%rowtype;
  v_application public.guest_applications%rowtype;
  v_name text;
  v_email text;
  v_phone text;
  v_phone_digits text;
  v_instagram text;
  v_avatar_url text;
begin
  select * into v_intent
  from public.guest_payment_intents
  where id = p_intent_id
  for update;
  if not found then raise exception 'Payment intent not found.'; end if;
  if v_intent.guest_application_id is not null then return v_intent.guest_application_id; end if;
  if nullif(v_intent.applicant_data->>'whatsapp_verified_at', '') is null then
    raise exception 'Verify the WhatsApp number before submitting this application.';
  end if;

  select * into v_event
  from public.events
  where id = v_intent.event_id and status = 'published';
  if not found then raise exception 'This event is not available for applications.'; end if;
  if v_event.application_opens_at is not null and now() < v_event.application_opens_at then
    raise exception 'Guest list registration has not opened yet.';
  end if;
  if v_event.application_link_closes_at is not null and now() >= v_event.application_link_closes_at then
    raise exception 'Event guestlist registrations have now been closed.';
  end if;

  v_name := trim(coalesce(v_intent.applicant_data->>'name', ''));
  v_email := lower(trim(coalesce(v_intent.applicant_data->>'email', '')));
  v_phone := trim(coalesce(v_intent.applicant_data->>'phone', ''));
  v_phone_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
  v_instagram := nullif(regexp_replace(trim(coalesce(v_intent.applicant_data->>'instagram_username', '')), '^@', ''), '');
  v_avatar_url := nullif(trim(coalesce(v_intent.applicant_data->>'avatar_url', '')), '');
  if length(v_name) < 2 or length(v_email) < 3 or length(v_phone_digits) not between 8 and 15 then
    raise exception 'Applicant contact details are invalid.';
  end if;
  if v_instagram is not null and (length(v_instagram) > 30 or v_instagram !~ '^[A-Za-z0-9._]+$') then
    raise exception 'Instagram username is invalid.';
  end if;
  if v_avatar_url is not null and v_avatar_url !~ '^https://[^/]+/storage/v1/object/public/guest-avatars/' then
    v_avatar_url := null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_event.id::text || ':' || v_email, 0));
  perform pg_advisory_xact_lock(hashtextextended(v_event.id::text || ':phone:' || v_phone_digits, 0));

  if exists (
    select 1 from public.guest_applications ga
    where ga.event_id = v_event.id
      and (
        lower(trim(coalesce(ga.guest_email, ''))) = v_email
        or regexp_replace(coalesce(ga.guest_phone, ''), '[^0-9]', '', 'g') = v_phone_digits
      )
  ) then
    raise exception 'A duplicate application already exists for this event using this email or WhatsApp number.';
  end if;

  insert into public.guest_applications (
    event_id, guest_id, guest_name, guest_email, guest_phone, instagram_username, guest_avatar_url, status,
    application_fee_paise, payment_status, payment_access_token_hash,
    razorpay_order_id, razorpay_payment_id, check_in_token
  ) values (
    v_event.id, v_intent.guest_id, v_name, v_email, v_phone, v_instagram, v_avatar_url, 'pending',
    2000, 'paid', v_intent.payment_access_token_hash,
    v_intent.razorpay_order_id, p_payment_id, gen_random_uuid()
  ) returning * into v_application;

  update public.guest_payment_intents
  set payment_status = 'paid', razorpay_payment_id = p_payment_id,
      guest_application_id = v_application.id, paid_at = now()
  where id = v_intent.id;
  return v_application.id;
end;
$$;

revoke all on function public.finalize_paid_guest_application(uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_paid_guest_application(uuid, text) to service_role;
