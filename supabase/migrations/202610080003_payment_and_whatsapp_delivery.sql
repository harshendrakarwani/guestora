-- Razorpay application checkout state and WhatsApp delivery receipts.
alter table public.guest_applications
  add column if not exists payment_access_token_hash text,
  add column if not exists razorpay_order_id text,
  add column if not exists razorpay_payment_id text,
  add column if not exists razorpay_refund_id text,
  add column if not exists whatsapp_delivery_status text,
  add column if not exists whatsapp_status_updated_at timestamptz,
  add column if not exists whatsapp_delivery_error text;

create unique index if not exists guest_applications_razorpay_order_id_unique
  on public.guest_applications (razorpay_order_id)
  where razorpay_order_id is not null;

create unique index if not exists guest_applications_razorpay_payment_id_unique
  on public.guest_applications (razorpay_payment_id)
  where razorpay_payment_id is not null;

create or replace function public.require_application_fee_before_approval()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'approved'
     and old.status is distinct from 'approved'
     and new.payment_status is distinct from 'paid' then
    raise exception 'The ₹20 application fee must be paid before approval.';
  end if;
  return new;
end;
$$;

drop trigger if exists guest_applications_require_fee_before_approval
  on public.guest_applications;

create trigger guest_applications_require_fee_before_approval
before update of status on public.guest_applications
for each row
execute function public.require_application_fee_before_approval();
