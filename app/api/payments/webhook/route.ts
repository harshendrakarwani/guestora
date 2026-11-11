import { createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase-admin";
import { isValidHmac } from "@/lib/razorpay-server";
import { getRazorpayConfig } from "@/lib/razorpay-server";

type PaymentEntity = { id?: string; order_id?: string; amount?: number; currency?: string; status?: string; notes?: { application_id?: string; intent_id?: string } };
type WebhookPayload = {
  event?: string;
  payload?: {
    payment?: { entity?: PaymentEntity };
    refund?: { entity?: { id?: string; payment_id?: string } };
  };
};

export async function POST(request: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Webhook is not configured." }, { status: 503 });
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!isValidHmac(signature, expected)) return Response.json({ error: "Invalid webhook signature." }, { status: 401 });

  let payload: WebhookPayload;
  try { payload = JSON.parse(rawBody) as WebhookPayload; }
  catch { return Response.json({ error: "Invalid webhook payload." }, { status: 400 }); }
  let admin;
  try { admin = createAdminClient(); }
  catch { return Response.json({ error: "Supabase server credentials are missing." }, { status: 503 }); }

  const payment = payload.payload?.payment?.entity;
  if (payload.event === "payment.captured" && payment?.order_id && payment.id) {
    const { data: listingEvent, error: listingLookupError } = await admin.from("events")
      .select("id, listing_fee_status")
      .eq("razorpay_listing_order_id", payment.order_id).maybeSingle();
    if (listingLookupError) return Response.json({ error: "Could not load event listing payment." }, { status: 500 });
    if (listingEvent) {
      if (payment.amount !== 25000 || payment.currency !== "INR") return Response.json({ error: "Listing payment amount is invalid." }, { status: 409 });
      const { error: publishError } = await admin.from("events").update({
        listing_fee_status: "paid", listing_fee_paise: 25000, razorpay_listing_payment_id: payment.id, status: "published",
      }).eq("id", listingEvent.id).eq("listing_fee_status", "unpaid");
      if (publishError) return Response.json({ error: "Could not publish the paid event listing." }, { status: 500 });
    }
  }
  if ((payload.event === "payment.captured" || payload.event === "payment.failed") && payment?.order_id) {
    const { data: intent, error: intentLookupError } = await admin.from("guest_payment_intents")
      .select("id, amount_paise, payment_status, guest_application_id, orphan_refund_status, orphan_refund_id")
      .eq("razorpay_order_id", payment.order_id).maybeSingle();
    if (intentLookupError) return Response.json({ error: "Could not load payment intent." }, { status: 500 });
    if (intent && payload.event === "payment.captured") {
      if (payment.amount !== intent.amount_paise || payment.currency !== "INR" || !payment.id) {
        return Response.json({ error: "Captured payment does not match the application fee." }, { status: 409 });
      }
      if (["processing", "pending", "refunded"].includes(intent.orphan_refund_status ?? "")) {
        return Response.json({ received: true, refundReconciliationRequired: intent.orphan_refund_status !== "refunded" }, { status: 202 });
      }
      const { error: finalizeError } = await admin.rpc("finalize_paid_guest_application", { p_intent_id: intent.id, p_payment_id: payment.id });
      if (finalizeError) {
        // A captured payment with no application must not remain charged. Claim
        // the orphan refund once; an ambiguous provider result stays locked.
        const { data: refundClaim, error: claimError } = await admin.from("guest_payment_intents")
          .update({ orphan_refund_status: "processing", razorpay_payment_id: payment.id })
          .eq("id", intent.id)
          .is("guest_application_id", null)
          .or("orphan_refund_status.is.null,orphan_refund_status.eq.failed")
          .select("id")
          .maybeSingle();
        if (claimError) return Response.json({ error: "Captured payment could not be finalized or safely reconciled." }, { status: 500 });
        if (!refundClaim) return Response.json({ received: true, refundReconciliationRequired: true }, { status: 202 });

        const config = getRazorpayConfig();
        if (!config) {
          await admin.from("guest_payment_intents").update({ orphan_refund_status: "failed" }).eq("id", intent.id).eq("orphan_refund_status", "processing");
          return Response.json({ error: "Captured payment has no application and requires manual refund; Razorpay credentials are missing." }, { status: 503 });
        }
        let refundResponse: Response;
        try {
          refundResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(payment.id)}/refund`, {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ amount: intent.amount_paise, notes: { payment_intent_id: intent.id, reason: "application_not_finalized" } }),
            cache: "no-store",
            signal: AbortSignal.timeout(12_000),
          });
        } catch {
          return Response.json({ received: true, refundReconciliationRequired: true }, { status: 202 });
        }
        const refundResult = await refundResponse.json().catch(() => ({})) as { id?: string };
        if (!refundResponse.ok || !refundResult.id) {
          if (refundResponse.status >= 400 && refundResponse.status < 500) {
            await admin.from("guest_payment_intents").update({ orphan_refund_status: "failed" }).eq("id", intent.id).eq("orphan_refund_status", "processing");
          }
          return Response.json({ error: "Captured payment could not be finalized; refund reconciliation is required." }, { status: 202 });
        }
        const { error: refundSaveError } = await admin.from("guest_payment_intents")
          .update({ orphan_refund_status: "pending", orphan_refund_id: refundResult.id })
          .eq("id", intent.id).eq("orphan_refund_status", "processing");
        if (refundSaveError) return Response.json({ received: true, refundReconciliationRequired: true }, { status: 202 });
      }
    } else if (intent && payload.event === "payment.failed" && intent.payment_status !== "paid") {
      const { error } = await admin.from("guest_payment_intents")
        .update({ payment_status: "failed", razorpay_payment_id: payment.id ?? null })
        .eq("id", intent.id).neq("payment_status", "paid")
        .or("orphan_refund_status.is.null,orphan_refund_status.not.in.(processing,pending,refunded)");
      if (error) return Response.json({ error: "Could not save failed payment status." }, { status: 500 });
    }
  }
  if ((payload.event === "payment.captured" || payload.event === "payment.failed") && payment?.order_id) {
    const { data: application, error: lookupError } = await admin.from("guest_applications")
      .select("id, status, payment_status, application_fee_paise, razorpay_payment_id, razorpay_refund_id")
      .eq("razorpay_order_id", payment.order_id).maybeSingle();
    if (lookupError) return Response.json({ error: "Could not load application payment." }, { status: 500 });
    if (application && payload.event === "payment.captured" && application.status === "rejected") {
      if (application.payment_status === "refunded" || application.razorpay_refund_id) return Response.json({ received: true });
      const { data: lock, error: lockError } = await admin.from("guest_applications")
        .update({ payment_status: "refund_processing", razorpay_payment_id: payment.id ?? null })
        .eq("id", application.id).eq("status", "rejected").is("razorpay_refund_id", null)
        .neq("payment_status", "refund_processing").select("id").maybeSingle();
      if (lockError) return Response.json({ error: "Could not prepare the refund." }, { status: 500 });
      if (lock) {
        const config = getRazorpayConfig();
        if (!config || !payment.id) {
          await admin.from("guest_applications").update({ payment_status: "paid" }).eq("id", application.id);
          return Response.json({ error: "A rejected application was paid, but Razorpay refund credentials are missing." }, { status: 503 });
        }
        let refundResponse: Response;
        try {
          refundResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(payment.id)}/refund`, {
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
          // This lock also prevents a retried webhook from duplicating a
          // refund whose provider response was lost.
          return Response.json({ received: true, refundReconciliationRequired: true }, { status: 202 });
        }
        const refundResult = await refundResponse.json().catch(() => ({})) as { id?: string };
        if (!refundResponse.ok || !refundResult.id) {
          return Response.json({ error: "Payment captured after rejection; refund outcome needs reconciliation before retrying." }, { status: 502 });
        }
        const { error: refundSaveError } = await admin.from("guest_applications")
          .update({ payment_status: "refund_pending", razorpay_refund_id: refundResult.id })
          .eq("id", application.id).eq("payment_status", "refund_processing");
        if (refundSaveError) return Response.json({ error: "Razorpay accepted the refund, but Guestora could not save it." }, { status: 500 });
      }
    } else if (application) {
      const status = payload.event === "payment.captured" ? "paid" : "failed";
      let query = admin.from("guest_applications")
        .update({ payment_status: status, razorpay_payment_id: payment.id ?? null })
        .eq("id", application.id);
      if (status === "failed") query = query.not("payment_status", "in", "(paid,refund_processing,refund_pending,refunded)");
      else query = query.not("payment_status", "in", "(refund_processing,refund_pending,refunded)");
      const { error } = await query;
      if (error) return Response.json({ error: "Could not save payment status." }, { status: 500 });
    }
  }

  const refund = payload.payload?.refund?.entity;
  if (payload.event === "refund.processed" && refund?.payment_id) {
    const { error: orphanRefundError } = await admin.from("guest_payment_intents")
      .update({ orphan_refund_status: "refunded", orphan_refund_id: refund.id ?? null })
      .eq("razorpay_payment_id", refund.payment_id)
      .not("orphan_refund_status", "is", null);
    if (orphanRefundError) return Response.json({ error: "Could not save orphan payment refund status." }, { status: 500 });
    const { data: applications, error } = await admin.from("guest_applications")
      .select("id, event_id, status, guest_name, guest_email, guest_phone, application_fee_paise, whatsapp_refund_delivery_status")
      .eq("razorpay_payment_id", refund.payment_id);
    if (error) return Response.json({ error: "Could not load refunded applications." }, { status: 500 });

    for (const application of applications ?? []) {
      const { error: savedStatusError } = await admin.from("guest_applications")
        .update({ payment_status: "refunded", razorpay_refund_id: refund.id ?? null })
        .eq("id", application.id);
      if (savedStatusError) return Response.json({ error: "Could not save refund status." }, { status: 500 });
      if (application.status !== "rejected" || !application.guest_phone) continue;

      const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      const apiVersion = process.env.WHATSAPP_API_VERSION;
      const templateName = process.env.WHATSAPP_REFUND_TEMPLATE_NAME;
      const language = process.env.WHATSAPP_REFUND_TEMPLATE_LANGUAGE || "en";
      if (!accessToken || !phoneNumberId || !apiVersion || !templateName) {
        console.error("Refund is processed, but the WhatsApp refund template is not configured.", { applicationId: application.id });
        continue;
      }

      const { data: claimed, error: claimError } = await admin.from("guest_applications")
        .update({
          whatsapp_refund_delivery_status: "sending",
          whatsapp_refund_status_updated_at: new Date().toISOString(),
          whatsapp_refund_delivery_error: null,
        })
        .eq("id", application.id)
        .eq("payment_status", "refunded")
        .eq("status", "rejected")
        .or("whatsapp_refund_delivery_status.is.null,whatsapp_refund_delivery_status.eq.failed")
        .select("id")
        .maybeSingle();
      if (claimError) return Response.json({ error: "Could not reserve the refund WhatsApp notification." }, { status: 500 });
      if (!claimed) continue;

      const { data: event, error: eventError } = await admin.from("events").select("title").eq("id", application.event_id).maybeSingle();
      if (eventError || !event) {
        await admin.from("guest_applications").update({
          whatsapp_refund_delivery_status: "failed",
          whatsapp_refund_status_updated_at: new Date().toISOString(),
          whatsapp_refund_delivery_error: "Could not load event details.",
        }).eq("id", application.id).eq("whatsapp_refund_delivery_status", "sending");
        continue;
      }

      const guestName = application.guest_name?.trim() || application.guest_email?.split("@")[0] || "Guest";
      const phone = application.guest_phone.replace(/\D/g, "");
      let metaResponse: Response;
      try {
        metaResponse = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: phone,
            type: "template",
            template: {
              name: templateName,
              language: { code: language },
              components: [{
                type: "body",
                parameters: [guestName, event.title, (application.application_fee_paise / 100).toFixed(2)]
                  .map((text) => ({ type: "text", text })),
              }],
            },
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        });
      } catch {
        // An accepted WhatsApp message can outlive a timed-out connection.
        // Keep the sending claim to avoid accidental duplicate notifications.
        continue;
      }
      const metaResult = await metaResponse.json().catch(() => ({})) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
      const messageId = metaResult.messages?.[0]?.id;
      if (!metaResponse.ok || !messageId) {
        await admin.from("guest_applications").update({
          whatsapp_refund_delivery_status: "failed",
          whatsapp_refund_status_updated_at: new Date().toISOString(),
          whatsapp_refund_delivery_error: metaResult.error?.message || "WhatsApp did not confirm the refund notice.",
        }).eq("id", application.id).eq("whatsapp_refund_delivery_status", "sending");
        continue;
      }
      const { error: saveMessageError } = await admin.from("guest_applications").update({
        whatsapp_refund_delivery_status: "accepted",
        whatsapp_refund_message_id: messageId,
        whatsapp_refund_status_updated_at: new Date().toISOString(),
        whatsapp_refund_delivery_error: null,
      }).eq("id", application.id).eq("whatsapp_refund_delivery_status", "sending");
      if (saveMessageError) return Response.json({ error: "WhatsApp accepted the refund notice, but Guestora could not save its delivery record." }, { status: 500 });
    }
  }

  return Response.json({ received: true });
}
