# Guestora payments

## Payment gates

- Organizers save an event as a draft. Publishing opens Razorpay Checkout for ₹250. Only a confirmed capture marks the fee paid and publishes the event. The fee is non-refundable. Once listed, event details remain editable.
- Guests pay ₹30 before a guest application is created. A signed Razorpay webhook or verified Checkout response finalizes the application only after capture. Organizer approval remains blocked until that payment is recorded.
- Organizers earn 40% of eligible, paid application fees (₹12 of each ₹30 fee). A claim is available after the event entry deadline and once all applications have been reviewed. Rejected/refunded applications are excluded.
- A commission claim creates one RazorpayX Payout Link for the calculated total. Razorpay emails the organizer a secure link where they choose their bank account or UPI ID; Guestora does not store payout account details. Duplicate claims for the same event are blocked.
- Rejected paid applications receive a full refund. Refunded applications are removed from the organizer-share ledger balance. Arriving after the event's published entry/QR deadline may result in denied entry, with no refund for that late arrival or denial.

## Required Supabase setup

Apply all migrations in order, including `supabase/migrations/202610080004_marketplace_payments_and_support.sql`, `supabase/migrations/202610160001_remove_organizer_commission.sql`, and `supabase/migrations/202610260001_application_fee_and_organizer_commission.sql`, before deploying this version. The latest migration sets new applications to ₹30, retains ₹20 in-flight orders, records the 40% share, and adds the commission-claim ledger. Do not publish the new code before applying it.

## Razorpay Test Mode

1. Use a Razorpay Test Mode account and add `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` to Vercel Preview variables. Add `SUPABASE_SERVICE_ROLE_KEY` as a Secret. These values must never use a `NEXT_PUBLIC_` prefix.
2. Configure a webhook at `https://YOUR-PUBLIC-VERCEL-PREVIEW/api/payments/webhook` with a long random secret. Subscribe to `payment.captured`, `payment.failed`, and `refund.processed`; save that secret as `RAZORPAY_WEBHOOK_SECRET` in Preview.
3. Enable automatic capture in Razorpay. Guestora only publishes listings or submits applications once a payment is captured.
4. Deploy a Preview and confirm: successful and failed ₹250 listing payment; edit a paid event; successful and failed ₹20 guest checkout; refresh after closing Checkout; duplicate submission; paid-application rejection and refund; entry-deadline terms; and webhook processing.

## Production

After Preview payment checks are complete, configure live Razorpay keys and webhook secret in Vercel Production, set `NEXT_PUBLIC_SITE_URL=https://guestora.in`, apply the migration to Production, and then publish the deployment. To enable commission claims, also configure RazorpayX Production secrets in Vercel:

- `RAZORPAYX_KEY_ID`
- `RAZORPAYX_KEY_SECRET`
- `RAZORPAYX_ACCOUNT_NUMBER` (Guestora's RazorpayX funding account, not the organizer's account)

RazorpayX Payout Links are not available in Test Mode, so the payout flow can only be exercised with an approved Production RazorpayX setup. Never paste keys or access tokens into chat or source control.
