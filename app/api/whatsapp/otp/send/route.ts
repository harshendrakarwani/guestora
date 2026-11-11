import { createAdminClient } from "@/lib/supabase-admin";
import { createWhatsAppOtp, hashWhatsAppOtp, hashWhatsAppOtpIp, normalizeWhatsAppDigits } from "@/lib/whatsapp-otp";

export const maxDuration = 60;

const jsonError = (message: string, status: number) => Response.json({ error: message }, { status });

export async function POST(request: Request) {
  let body: { eventId?: string; phone?: string };
  try { body = await request.json() as typeof body; }
  catch { return jsonError("The request body was not valid JSON.", 400); }

  if (!body.eventId || typeof body.phone !== "string") return jsonError("Event and WhatsApp number are required.", 400);
  const phone = normalizeWhatsAppDigits(body.phone);
  if (!phone) return jsonError("Enter a valid WhatsApp number with country code.", 400);

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_API_VERSION || "v25.0";
  const templateName = process.env.WHATSAPP_OTP_TEMPLATE_NAME;
  const templateLanguage = process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE || "en_US";
  if (!accessToken || !phoneNumberId || !templateName) {
    return jsonError("WhatsApp verification is not configured. Add an approved OTP template in the server settings.", 503);
  }

  let admin;
  try { admin = createAdminClient(); }
  catch { return jsonError("WhatsApp verification is temporarily unavailable.", 503); }

  const now = new Date();
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ipHash = hashWhatsAppOtpIp(forwardedFor || request.headers.get("x-real-ip") || "unknown");
  const code = createWhatsAppOtp();
  const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
  const { data: challengeId, error: insertError } = await admin.rpc("create_rate_limited_whatsapp_otp", {
    p_event_id: body.eventId,
    p_phone: phone,
    p_code_hash: hashWhatsAppOtp(code, body.eventId, phone),
    p_expires_at: expiresAt,
    p_ip_hash: ipHash,
  });
  if (insertError) return jsonError("Could not start WhatsApp verification. Please try again.", 500);
  if (challengeId === "event_unavailable") return jsonError("This event is not available for applications.", 404);
  if (typeof challengeId === "string" && challengeId.startsWith("event_not_open:")) {
    const opensAt = new Date(challengeId.slice("event_not_open:".length));
    return jsonError(`Guest list registration opens at ${opensAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}.`, 409);
  }
  if (challengeId === "event_closed") return jsonError("Event guest list registrations have now closed.", 409);
  if (challengeId === "phone_cooldown") return jsonError("Please wait one minute before requesting another code.", 429);
  if (challengeId === "rate_limited") return jsonError("Too many verification requests. Try again later.", 429);
  if (typeof challengeId !== "string") return jsonError("Could not start WhatsApp verification. Please try again.", 500);

  let response: Response;
  try {
    response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLanguage },
          components: [
            { type: "body", parameters: [{ type: "text", text: code }] },
            // Meta represents an approved OTP Copy code button as a URL button
            // in the send-message payload. The code is still passed as text.
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
          ],
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    // Delivery may have reached Meta before the connection timed out. Keep the
    // challenge valid and throttled so a late OTP does not become unusable.
    return jsonError("WhatsApp delivery could not be confirmed. Wait one minute before requesting another code.", 502);
  }
  if (!response.ok) {
    return jsonError("WhatsApp could not send the code. Check that the approved Authentication template is configured.", 502);
  }
  return Response.json({ sent: true, expiresInSeconds: 300 });
}
