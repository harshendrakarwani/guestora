-- Refund requests move a paid application through processing and pending
-- before Razorpay confirms the final refunded state.
do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.guest_applications'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%payment_status%'
  loop
    execute format(
      'alter table public.guest_applications drop constraint %I',
      v_constraint.conname
    );
  end loop;
end;
$$;

alter table public.guest_applications
  add constraint guest_applications_payment_status_check
  check (payment_status in (
    'pending',
    'failed',
    'authorized',
    'paid',
    'refund_processing',
    'refund_pending',
    'refunded'
  ));
