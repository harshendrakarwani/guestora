# Guestora manual organizer commission claims

This flow automates claim collection, eligibility checks, email alerts, and claim tracking. It does not send money automatically. After the organizer submits UPI or bank details, an authorized Guestora admin makes the transfer in their banking app and records the transfer reference in Guestora.

## One-time setup

1. Run `supabase/migrations/202611070001_manual_organizer_commission_claims.sql` in the Guestora Supabase SQL Editor. The earlier commission migration must already have been applied.
2. In the Guestora Vercel project, add these **Production** environment variables:
   - `COMMISSION_ADMIN_EMAILS`: set this to your one Guestora sign-in email. The admin page rejects configuration with multiple emails.
   - `COMMISSION_PAYOUT_ENCRYPTION_KEY`: a private base64-encoded 32-byte key. Generate one in PowerShell:

     ```powershell
     $commissionBytes = New-Object byte[] 32
     $commissionRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
     $commissionRng.GetBytes($commissionBytes)
     [Convert]::ToBase64String($commissionBytes)
     $commissionRng.Dispose()
     ```

     Copy the printed value directly into Vercel. Keep it in a password manager. Do not rotate or lose it while claims with payout details are still pending or processing; those details cannot be decrypted without the same key.
3. Confirm the existing `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `NEXT_PUBLIC_SITE_URL` Production values are present. The sender must be verified in Resend. Commission alerts go to the single `COMMISSION_ADMIN_EMAILS` address and contain no bank or UPI details.
4. Redeploy the Guestora project after saving the environment variables.

## How claims are handled

1. An organizer opens the event’s commission page after entry closes and all applications have been reviewed.
2. They choose UPI or bank transfer, enter the destination, and submit one claim for that event.
3. Guestora encrypts the destination before storing it and sends an email alert with a secure review link.
4. Sign in to Guestora with an email listed in `COMMISSION_ADMIN_EMAILS`, open the link, and mark the claim as processing while arranging the transfer. For UPI claims, the review page also offers a QR code and a phone link with the payee, amount, and claim reference prefilled. You still review and authorize the transaction in your UPI app; it does not send a push approval or report payment status back to Guestora.
5. Send the transfer through the bank/UPI app, then enter its UTR or transaction reference and mark the claim paid. Guestora records the payment and marks that event’s eligible commission shares as transferred.

Payout details are erased when a claim is rejected or marked paid. Rejected claims can be resubmitted with corrected details. If the alert email fails, the claim is still saved; the organizer is told to contact support, and the admin can open the review queue directly at `/organizer/commission/admin`.

Guest payment collection, Razorpay refunds, and event application processing are not changed by this manual payout flow.
