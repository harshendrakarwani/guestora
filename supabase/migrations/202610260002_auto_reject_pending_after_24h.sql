-- Rejected applications that remain pending for 24 hours are marked as
-- auto-rejected. A Supabase cron job calls the protected Vercel endpoint every
-- minute; configure the two Vault secrets noted below before enabling it.
--
-- Required Supabase Vault secrets:
--   guestora_auto_reject_base_url = https://guestora.in
--   guestora_auto_reject_secret   = same random value as Vercel CRON_SECRET
--
-- Set CRON_SECRET in Vercel Production and redeploy before applying this
-- migration. Add the Vault secrets in Supabase Dashboard > Vault > Secrets.

alter table public.guest_applications
  add column if not exists auto_rejected boolean not null default false;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'guestora-auto-reject-pending-applications'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end;
$$;

select cron.schedule(
  'guestora-auto-reject-pending-applications',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'guestora_auto_reject_base_url')
        || '/api/cron/reject-expired-applications',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'guestora_auto_reject_secret'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 15000
    )
    where exists (
      select 1 from vault.decrypted_secrets
      where name in ('guestora_auto_reject_base_url', 'guestora_auto_reject_secret')
      having count(*) = 2
    );
  $job$
);
