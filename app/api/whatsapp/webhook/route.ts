import { createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase-admin";
import { isValidHmac } from "@/lib/razorpay-server";

type WhatsAppWebhook = {
  entry?: Array<{ changes?: Array<{ value?: { statuses?: Array<{
    id?: string;
    status?: string;
    timestamp?: string;
    errors?: Array<{ title?: string; message?: string; code?: number }>;
  }> } }> }>;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return Response.json({ error: "Webhook verification failed." }, { status: 403 });
}

export async function POST(request: Request) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return Response.json({ error: "WhatsApp webhook is not configured." }, { status: 503 });
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256")?.replace(/^sha256=/, "") ?? "";
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  if (!isValidHmac(signature, expected)) return Response.json({ error: "Invalid webhook signature." }, { status: 401 });

  let payload: WhatsAppWebhook;
  try { payload = JSON.parse(rawBody) as WhatsAppWebhook; }
  catch { return Response.json({ error: "Invalid webhook payload." }, { status: 400 }); }
  const statuses = payload.entry?.flatMap((entry) => entry.changes?.flatMap((change) => change.value?.statuses ?? []) ?? []) ?? [];
  if (!statuses.length) return Response.json({ received: true });

  let admin;
  try { admin = createAdminClient(); }
  catch { return Response.json({ error: "Supabase server credentials are missing." }, { status: 503 }); }

  for (const status of statuses) {
    if (!status.id || !status.status) continue;
    const errorText = status.errors?.map((item) => item.title || item.message || (item.code ? `Code ${item.code}` : "")).filter(Boolean).join("; ") || null;
    const update: Record<string, string | null> = {
      whatsapp_delivery_status: status.status,
      whatsapp_status_updated_at: status.timestamp ? new Date(Number(status.timestamp) * 1000).toISOString() : new Date().toISOString(),
      whatsapp_delivery_error: status.status === "failed" ? errorText : null,
    };
    const { error } = await admin.from("guest_applications").update(update).eq("whatsapp_message_id", status.id);
    if (error) return Response.json({ error: "Could not save WhatsApp delivery status." }, { status: 500 });
    if (["accepted", "sent", "delivered", "read", "failed"].includes(status.status)) {
      const refundStatus = status.status === "sent" ? "accepted" : status.status;
      const { error: refundStatusError } = await admin.from("guest_applications").update({
        whatsapp_refund_delivery_status: refundStatus,
        whatsapp_refund_status_updated_at: update.whatsapp_status_updated_at,
        whatsapp_refund_delivery_error: status.status === "failed" ? errorText : null,
      }).eq("whatsapp_refund_message_id", status.id);
      if (refundStatusError) return Response.json({ error: "Could not save refund WhatsApp delivery status." }, { status: 500 });
    }
  }
  return Response.json({ received: true });
}
