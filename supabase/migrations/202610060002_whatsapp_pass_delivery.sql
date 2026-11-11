alter table public.guest_applications
  add column if not exists whatsapp_pass_sent_at timestamptz,
  add column if not exists whatsapp_message_id text;
