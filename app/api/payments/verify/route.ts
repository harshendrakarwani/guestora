import { createAdminClient } from "@/lib/supabase-admin";
import { getRequestUser } from "@/lib/request-auth";
import { getRazorpayPayment, safeHexEqual, verifyCheckoutSignature, hashPaymentAccessToken } from "@/lib/razorpay-server";

export const maxDuration = 60;

type Body = { intentId?: string; paymentAccessToken?: string; razorpay_order_id?: string; razorpay_payment_id?: string; razorpay_signature?: string };
const error = (message: string, status: number) => Response.json({ error: message }, { status });

export async function POST(request: Request) {
  let body: Body;
  try { body = await request.json() as Body; } catch { return error("The payment response was not valid JSON.", 400); }
  const { intentId, razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = body;
  if (!intentId || !orderId || !paymentId || !signature) return error("The payment response is incomplete.", 400);
  let admin;
  try { admin = createAdminClient(); } catch { return error("Supabase server credentials are missing.", 503); }
  const { data: intent, error: lookupError } = await admin.from("guest_payment_intents")
    .select("id, event_id, guest_id, amount_paise, payment_access_token_hash, razorpay_order_id, payment_status, guest_application_id, orphan_refund_status")
    .eq("id", intentId).maybeSingle();
  if (lookupError) return error("Could not load payment details.", 500);
  if (!intent) return error("Payment session not found.", 404);
  if (intent.razorpay_order_id !== orderId) return error("This payment does not match the checkout.", 409);
  if (intent.guest_id) {
    let user;
    try { user = await getRequestUser(request); } catch { return error("Unable to verify your account.", 503); }
    if (!user || user.id !== intent.guest_id) return error("Sign in with the account used for this application.", 403);
  } else {
    const supplied = body.paymentAccessToken ? hashPaymentAccessToken(body.paymentAccessToken) : "";
    if (!intent.payment_access_token_hash || !safeHexEqual(supplied, intent.payment_access_token_hash)) return error("This guest payment session is no longer valid.", 403);
  }
  if (!verifyCheckoutSignature(orderId, paymentId, signature)) return error("Razorpay could not verify this payment signature.", 400);
  let payment;
  try { payment = await getRazorpayPayment(paymentId); } catch (caught) { return error(caught instanceof Error ? caught.message : "Unable to confirm payment.", 502); }
  if (payment.order_id !== orderId || payment.amount !== intent.amount_paise || payment.currency !== "INR") return error("Payment amount or order does not match the application fee.", 409);
  if (payment.status === "failed") {
    const { data: failedUpdate, error: failedUpdateError } = await admin.from("guest_payment_intents")
      .update({ payment_status: "failed", razorpay_payment_id: paymentId })
      .eq("id", intent.id).eq("payment_status", intent.payment_status).select("id").maybeSingle();
    if (failedUpdateError) return error("Could not save the payment result. Refresh payment status before trying again.", 500);
    if (!failedUpdate) return error("Payment status changed while checking. Refresh it before taking another action.", 409);
    return error("Razorpay reports that this payment failed. Start a new application checkout to retry.", 402);
  }
  const captured = payment.status === "captured" || payment.captured === true;
  if (!captured) {
    const nextStatus = payment.status === "authorized" ? "authorized" : "pending";
    const { data: statusUpdate, error: statusUpdateError } = await admin.from("guest_payment_intents")
      .update({ payment_status: nextStatus })
      .eq("id", intent.id).eq("payment_status", intent.payment_status).select("id").maybeSingle();
    if (statusUpdateError) return error("Could not save the payment status. Refresh before retrying.", 500);
    if (!statusUpdate) return error("Payment status changed while checking. Refresh it before taking another action.", 409);
    return Response.json({ paid: false, paymentStatus: payment.status, message: "Payment is awaiting capture confirmation. Your application has not been submitted yet." });
  }
  if (["processing", "pending", "refunded"].includes(intent.orphan_refund_status ?? "")) {
    return error("This captured payment is being reconciled as a refund. Do not start another payment; contact support if the status does not update.", 409);
  }
  const { data: applicationId, error: finalizeError } = await admin.rpc("finalize_paid_guest_application", { p_intent_id: intent.id, p_payment_id: paymentId });
  if (finalizeError || !applicationId) return error(`Payment captured, but application finalization needs attention: ${finalizeError?.message || "Please contact support."}`, 500);
  return Response.json({ paid: true, paymentStatus: "paid", applicationId, message: "Payment received. Your application is now submitted for organizer approval." });
}
