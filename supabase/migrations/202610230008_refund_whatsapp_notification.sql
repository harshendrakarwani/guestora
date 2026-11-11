alter table public.guest_applications
  add column if not exists whatsapp_refund_delivery_status text,
  add column if not exists whatsapp_refund_message_id text,
  add column if not exists whatsapp_refund_status_updated_at timestamptz,
  add column if not exists whatsapp_refund_delivery_error text;

alter table public.guest_applications
  drop constraint if exists guest_applications_whatsapp_refund_delivery_status_check;

alter table public.guest_applications
  add constraint guest_applications_whatsapp_refund_delivery_status_check
  check (whatsapp_refund_delivery_status is null or whatsapp_refund_delivery_status in ('sending', 'accepted', 'delivered', 'read', 'failed'));
