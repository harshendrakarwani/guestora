-- Track captured Razorpay payments that could not produce an application.
-- The state claim prevents webhook retries from issuing a second refund.
alter table public.guest_payment_intents
  add column if not exists orphan_refund_status text,
  add column if not exists orphan_refund_id text;

alter table public.guest_payment_intents
  drop constraint if exists guest_payment_intents_orphan_refund_status_check;
alter table public.guest_payment_intents
  add constraint guest_payment_intents_orphan_refund_status_check
  check (orphan_refund_status is null or orphan_refund_status in ('processing', 'pending', 'failed', 'refunded'));

create unique index if not exists guest_payment_intents_orphan_refund_id_unique
  on public.guest_payment_intents (orphan_refund_id)
  where orphan_refund_id is not null;
