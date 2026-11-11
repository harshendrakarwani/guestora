# Guestora WhatsApp pass delivery

Guestora sends an approved guest a WhatsApp template containing their event details and QR pass link. The app also records Meta's accepted, delivered, read, and failed message statuses.

## Verify a guest's WhatsApp number before event application

The event application form sends a six-digit code using the approved Authentication template configured by `WHATSAPP_OTP_TEMPLATE_NAME` and `WHATSAPP_OTP_TEMPLATE_LANGUAGE`. The code expires after five minutes. Guests must verify the number before checkout; the server also checks that verification before creating the paid application.

For the approved template shown as **English** in WhatsApp Manager, use language code `en`. The default template name is `guestora_whatsapp_number_verification`. Keep the existing Meta access token, WhatsApp phone-number ID, Supabase service-role key, and public Supabase URL configured as server environment variables. Never expose these values with a `NEXT_PUBLIC_` prefix.

Before enabling this flow in an environment, apply `supabase/migrations/202610200003_whatsapp_otp_verification.sql` in Supabase SQL Editor if it has not already been applied. This creates the private OTP challenge table and adds the database-side guard that prevents checkout finalization without phone verification.

## Send the QR image in WhatsApp

WhatsApp requires a template with an **image header** to deliver a QR image outside the 24-hour customer-service window. Keep the existing approved template as a fallback while Meta reviews the new one.

1. In WhatsApp Manager, create a Utility template such as `guestora_application_approved_qr` in English. Add an image header, the same four body parameters as the existing approval template, and the same dynamic URL button. Submit it and wait for Meta to approve it.
2. After approval, add `WHATSAPP_QR_TEMPLATE_NAME=guestora_application_approved_qr` to Vercel Production. If the template language is not `en`, also set `WHATSAPP_QR_TEMPLATE_LANGUAGE` to its exact language code. Redeploy.
3. Use **Resend pass** for an approved guest. Guestora will send the QR image in the template header and keep the View event details button as a backup. Without `WHATSAPP_QR_TEMPLATE_NAME`, Guestora continues using the existing link-only template.

The image header is generated from that guest's approved check-in token at `/api/pass-qr/{token}`. The endpoint only serves QR images for approved applications.

## Notify a guest when a rejection refund is processed

Create a **Utility** template named `guestora_application_rejected_refund_processed` in English (`en`) with no header and these three body variables, in order:

```text
Hi {{1}}, your application for {{2}} was not approved. Your refund of ₹{{3}} has been processed by Razorpay. It may take a few business days to appear in your account.
```

Use sample values such as `Harsh`, `Test event`, and `20.00` when submitting the template to Meta. After Meta approves it, add `WHATSAPP_REFUND_TEMPLATE_NAME=guestora_application_rejected_refund_processed` and `WHATSAPP_REFUND_TEMPLATE_LANGUAGE=en` to the Vercel environment. The message is sent only after Razorpay's `refund.processed` webhook confirms the refund; a refund that is merely initiated does not trigger it. Guestora records Meta's message ID and delivery status and prevents duplicate sends.

Apply `supabase/migrations/202610230008_refund_whatsapp_notification.sql` before deploying this notification feature.

## Guest dashboard access for guest applications

People who applied as guests can request a secure link at `/dashboard/access` or from the event page using the email address they entered on the application. Guestora emails a reusable link through Resend. It remains active until a newer link is requested, which revokes the previous link. Requests are throttled to three per email per hour and ten per IP per hour, and the link opens only guest-mode applications associated with that email address. Signed-in applicants continue to use their Guestora account dashboard. Each browser session lasts 30 days and can be refreshed by reopening the email link.

Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in Vercel. Verify the sender domain in Resend before sending production mail. `NEXT_PUBLIC_SITE_URL` should be `https://guestora.in` in Production so dashboard links use the public domain.

## Meta setup

1. Keep the Meta app in Development mode while testing. Use Meta's test WhatsApp number and add your own phone as an allowed test recipient.
2. Create and get approval for the Utility template `guestora_application_approved`, language `en`, with four body parameters in this order: guest name, event title, guest-list closing time, and event start time. Add a **dynamic website URL** button named `View event details` with base URL `https://www.guestora.in/pass/` and a sample URL such as `https://www.guestora.in/pass/00000000-0000-4000-8000-000000000000`. Guestora appends the approved guest's unique check-in token to the button URL, opening that guest's public pass page and QR code. The body is:

   ```text
   Hi {{1}}, your guest list application for {{2}} has been approved.
   The guest list closes at {{3}}. The event starts at {{4}}.
   View your event details using the button below.
   ```

3. In Meta for Developers, configure WhatsApp webhooks with callback URL `https://YOUR-PUBLIC-VERCEL-HOST/api/whatsapp/webhook`. Subscribe to the `messages` field. Use the same verify token that you add to Vercel.
4. In Vercel, add the Meta test access token, test phone-number ID, current Graph API version shown in Meta, `WHATSAPP_TEMPLATE_NAME=guestora_application_approved`, `WHATSAPP_TEMPLATE_LANGUAGE=en`, app secret, and webhook verify token as server environment variables. Add them to Preview first. Update the template settings in each Vercel environment you use (Preview and Production).
5. Approve a test application and confirm the pass arrives, then check its delivery status in Organizer.

The existing `guestora_application_approved` Utility template sends the approval and pass notification. The separate `guestora_application_rejected_refund_processed` template sends only after Razorpay confirms the refund. Guest dashboard links are sent by email, not WhatsApp.

The app's test sender can message only the recipients allowed in Meta's test setup. Before production, create a long-lived system-user token, add a production WhatsApp sender, complete Meta's required business/app setup, and publish the Meta app. Do not move your only business phone number to Cloud API until you have confirmed the number's migration/coexistence behavior and are ready for that change.

## Required environment values

See `.env.example`. Never put Meta tokens or the app secret in a `NEXT_PUBLIC_*` variable or in chat. `NEXT_PUBLIC_SITE_URL` must be the exact public host guests' phones can open; use the preview host for testing, then `https://guestora.in` for Production.

Run these migrations in Supabase SQL Editor if they have not already been applied, in order:

1. `supabase/migrations/202610060002_whatsapp_pass_delivery.sql`
2. `supabase/migrations/202610080003_payment_and_whatsapp_delivery.sql`
3. `supabase/migrations/202610080004_marketplace_payments_and_support.sql`
4. `supabase/migrations/202610200003_whatsapp_otp_verification.sql`
5. `supabase/migrations/202610230008_refund_whatsapp_notification.sql`
6. `supabase/migrations/202610230009_guest_dashboard_whatsapp_access.sql`
7. `supabase/migrations/202610240001_guest_dashboard_email_access.sql`
