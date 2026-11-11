-- Copy optional guest profile details from captured payment intents to
-- applications created before the profile-aware payment finalizer was active.

alter table public.guest_applications
  add column if not exists instagram_username text,
  add column if not exists guest_avatar_url text;

alter table public.guest_applications
  drop constraint if exists guest_applications_instagram_username_length;
alter table public.guest_applications
  add constraint guest_applications_instagram_username_length
  check (instagram_username is null or length(instagram_username) <= 30);

update public.guest_applications as application
set
  instagram_username = coalesce(
    nullif(trim(application.instagram_username), ''),
    case
      when length(nullif(regexp_replace(trim(coalesce(intent.applicant_data->>'instagram_username', '')), '^@', ''), '')) <= 30
       and nullif(regexp_replace(trim(coalesce(intent.applicant_data->>'instagram_username', '')), '^@', ''), '') ~ '^[A-Za-z0-9._]+$'
      then nullif(regexp_replace(trim(coalesce(intent.applicant_data->>'instagram_username', '')), '^@', ''), '')
      when length(nullif(regexp_replace(trim(coalesce(account.raw_user_meta_data->>'instagram_username', '')), '^@', ''), '')) <= 30
       and nullif(regexp_replace(trim(coalesce(account.raw_user_meta_data->>'instagram_username', '')), '^@', ''), '') ~ '^[A-Za-z0-9._]+$'
      then nullif(regexp_replace(trim(coalesce(account.raw_user_meta_data->>'instagram_username', '')), '^@', ''), '')
      else null
    end
  ),
  guest_avatar_url = coalesce(
    nullif(trim(application.guest_avatar_url), ''),
    case
      when intent.applicant_data->>'avatar_url' ~ '^https://[^/]+/storage/v1/object/public/guest-avatars/'
      then intent.applicant_data->>'avatar_url'
      when account.raw_user_meta_data->>'avatar_url' ~ '^https://[^/]+/storage/v1/object/public/guest-avatars/'
      then account.raw_user_meta_data->>'avatar_url'
      else null
    end
  )
from public.guest_payment_intents as intent
left join auth.users as account on account.id = intent.guest_id
where intent.guest_application_id = application.id
  and (
    application.instagram_username is null
    or application.guest_avatar_url is null
  );
