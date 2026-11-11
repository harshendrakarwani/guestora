import { createAdminClient } from "@/lib/supabase-admin";
import { getRequestUser } from "@/lib/request-auth";
import { getRazorpayConfig } from "@/lib/razorpay-server";
import { canStartRefund } from "@/lib/payment-safety";

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Sign in with your organizer account." }, { status: 401 });
  let body: { applicationId?: string };
  try { body = await request.json() as typeof body; }
  catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body.applicationId) return Response.json({ error: "Application ID is required." }, { status: 400 });
  let admin;
  try { admin = createAdminClient(); }
  catch { return Response.json({ error: "Supabase server credentials are missing." }, { status: 503 }); }
  const { data: application, error: applicationError } = await admin.from("guest_applications")
    .select("id, event_id, status, payment_status, application_fee_paise, razorpay_payment_id, razorpay_refund_id")
    .eq("id", body.applicationId).maybeSingle();
  if (applicationError) return Response.json({ error: applicationError.message }, { status: 500 });
  if (!application || application.status !== "rejected") return Response.json({ error: "Only rejected applications can be refunded." }, { status: 409 });
  const { data: event } = await admin.from("events").select("organizer_id").eq("id", application.event_id).maybeSingle();
  if (!event || event.organizer_id !== user.id) return Response.json({ error: "You can only refund applications for your own events." }, { status: 403 });
  if (application.payment_status === "refunded") return Response.json({ refunded: true, message: "This fee has already been refunded." });
  if (application.payment_status === "refund_processing") return Response.json({ error: "A refund request is already being reconciled. Check Razorpay before retrying so a second refund is not created." }, { status: 409 });
  if (application.payment_status === "refund_pending" && application.razorpay_refund_id) return Response.json({ refunded: false, message: "Razorpay has accepted the refund. It will update after confirmation." });
  if (!canStartRefund(application.payment_status as "pending" | "authorized" | "failed" | "paid" | "refund_processing" | "refund_pending" | "refunded") || !application.razorpay_payment_id) {
    return Response.json({ refunded: false, message: "No captured payment needs a refund." });
  }
  const config = getRazorpayConfig();
  if (!config) return Response.json({ error: "Razorpay credentials are not configured; refund this payment from Razorpay Dashboard." }, { status: 503 });

  const { data: lock, error: lockError } = await admin.from("guest_applications")
    .update({ payment_status: "refund_processing" })
    .eq("id", application.id)
    .eq("payment_status", "paid")
    .select("id")
    .maybeSingle();
  if (lockError) {
    console.error("Could not lock application refund", {
      applicationId: application.id,
      code: lockError.code,
      message: lockError.message,
    });
    return Response.json({ error: "Could not prepare this refund. No refund was sent." }, { status: 500 });
  }
  if (!lock) return Response.json({ error: "A refund is already in progress for this payment." }, { status: 409 });

  let response: Response;
  try {
    response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(application.razorpay_payment_id)}/refund`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: application.application_fee_paise, notes: { application_id: application.id } }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    // A timeout is ambiguous: Razorpay may have accepted the request. Keep
    // refund_processing so another click cannot create a second refund.
    return Response.json({ error: "Razorpay did not confirm the refund request. It is held for reconciliation; do not retry yet." }, { status: 502 });
  }
  const refund = await response.json().catch(() => ({})) as { id?: string; error?: { description?: string } };
  if (!response.ok || !refund.id) {
    // Without a refund ID, release no lock: an upstream error response may
    // still follow an accepted request. Reconcile in Razorpay before retrying.
    return Response.json({ error: `${refund.error?.description || "Razorpay could not confirm the refund."} The refund is held for reconciliation; do not retry yet.` }, { status: 502 });
  }
  const { data: savedRefund, error: saveError } = await admin.from("guest_applications")
    .update({ payment_status: "refund_pending", razorpay_refund_id: refund.id })
    .eq("id", application.id)
    .eq("payment_status", "refund_processing")
    .select("id")
    .maybeSingle();
  if (saveError) return Response.json({ error: "Razorpay accepted the refund, but Guestora could not save its reference." }, { status: 500 });
  if (!savedRefund) return Response.json({ refunded: true, message: "Razorpay already confirmed the refund." });
  return Response.json({ refunded: false, message: "Refund initiated in Razorpay. The payment status will update when Razorpay confirms it." });
}
