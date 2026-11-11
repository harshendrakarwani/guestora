import { createAdminClient } from "@/lib/supabase-admin";
import { getRequestUser } from "@/lib/request-auth";
import { getRazorpayConfig, hashPaymentAccessToken, safeHexEqual } from "@/lib/razorpay-server";
import { normalizeWhatsAppDigits } from "@/lib/whatsapp-otp";
import { canReconcileOrder, RESUMABLE_PAYMENT_STATES, type PaymentState } from "@/lib/payment-safety";

export const maxDuration = 60;

export async function POST(request: Request) {
  let body: { intentId?: string; paymentAccessToken?: string };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body.intentId) return Response.json({ error: "Payment session is required." }, { status: 400 });
  let admin;
  try { admin = createAdminClient(); } catch { return Response.json({ error: "Supabase server credentials are missing." }, { status: 503 }); }
  const { data: intent, error } = await admin.from("guest_payment_intents")
    .select("id, event_id, guest_id, applicant_data, payment_status, payment_access_token_hash, guest_application_id, razorpay_order_id, razorpay_payment_id, amount_paise, orphan_refund_status")
    .eq("id", body.intentId).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!intent) return Response.json({ error: "Payment session not found." }, { status: 404 });
  if (intent.guest_id) {
    let user;
    try { user = await getRequestUser(request); }
    catch { return Response.json({ error: "Unable to verify your account." }, { status: 503 }); }
    if (!user || user.id !== intent.guest_id) return Response.json({ error: "Sign in with the account used for this application." }, { status: 403 });
  } else {
    const token = body.paymentAccessToken ? hashPaymentAccessToken(body.paymentAccessToken) : "";
    if (!intent.payment_access_token_hash || !safeHexEqual(token, intent.payment_access_token_hash)) return Response.json({ error: "This guest payment session is no longer valid." }, { status: 403 });
  }
  if (["processing", "pending", "refunded"].includes(intent.orphan_refund_status ?? "")) {
    return Response.json({
      paymentStatus: intent.orphan_refund_status === "refunded" ? "refunded" : "refund_pending",
      canContinue: false,
      message: "This captured payment is being reconciled as a refund. Do not start another payment; contact support if the refund status does not update.",
    }, { status: 202 });
  }
  const applicantData = intent.applicant_data as { email?: string; phone?: string } | null;
  const email = applicantData?.email?.trim().toLowerCase();
  const phoneDigits = normalizeWhatsAppDigits(applicantData?.phone ?? "");
  if (email || phoneDigits) {
    const { data: existingApplicationId, error: applicationError } = await admin.rpc("find_duplicate_guest_application", {
      p_event_id: intent.event_id,
      p_guest_email: email ?? "",
      p_guest_phone: phoneDigits,
    });
    if (applicationError) return Response.json({ error: "Could not check whether your application was already submitted." }, { status: 500 });
    if (existingApplicationId) return Response.json({
      paymentStatus: "submitted",
      alreadySubmitted: true,
      applicationId: existingApplicationId,
      message: "Your application is already submitted. Go to your dashboard to check approval status.",
    });

    let activeIntentQuery = admin.from("guest_payment_intents")
      .select("id")
      .eq("event_id", intent.event_id)
      .filter("applicant_data->>email", "eq", email)
      .in("payment_status", [...RESUMABLE_PAYMENT_STATES])
      .order("created_at", { ascending: false })
      .limit(1);
    activeIntentQuery = intent.guest_id
      ? activeIntentQuery.eq("guest_id", intent.guest_id)
      : activeIntentQuery.is("guest_id", null);
    const { data: currentActiveIntent, error: activeIntentError } = await activeIntentQuery.maybeSingle();
    if (activeIntentError) return Response.json({ error: "Could not check your active checkout." }, { status: 500 });
    if (currentActiveIntent && currentActiveIntent.id !== intent.id) return Response.json({
      paymentStatus: "checkout_active_elsewhere",
      canContinue: false,
      message: "Another checkout is already active for this event. Use that checkout; don’t start another payment.",
    });
  }
  if (canReconcileOrder(intent.payment_status as PaymentState) && intent.razorpay_order_id) {
    const config = getRazorpayConfig();
    if (config) {
      let response: Response;
      try {
        response = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(intent.razorpay_order_id)}/payments`, {
          headers: { Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}` },
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        });
      } catch {
        return Response.json({ paymentStatus: intent.payment_status, canContinue: false, message: "Payment confirmation is taking longer than expected. Refresh again shortly; do not start a second checkout." }, { status: 202 });
      }
      if (!response.ok) return Response.json({ paymentStatus: intent.payment_status, canContinue: false, message: "Razorpay has not confirmed the payment yet. Refresh again shortly; do not start a second checkout." }, { status: 202 });
      const data = await response.json().catch(() => ({})) as { items?: Array<{ id?: string; status?: string; amount?: number; currency?: string }> };
      const captured = data.items?.find((item) => item.status === "captured" && item.id && item.amount === intent.amount_paise && item.currency === "INR");
      if (captured) {
        const { data: appId, error: finalizeError } = await admin.rpc("finalize_paid_guest_application", { p_intent_id: intent.id, p_payment_id: captured.id });
        if (finalizeError) return Response.json({ paymentStatus: "captured_needs_attention", canContinue: false, message: "Razorpay captured payment, but Guestora could not finalize the application. Contact support; do not pay again." }, { status: 202 });
        if (appId) return Response.json({ paymentStatus: "paid", applicationId: appId });
      }
    }
  }
  return Response.json({ paymentStatus: intent.payment_status, applicationId: intent.guest_application_id });
}
