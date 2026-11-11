import { createAdminClient } from "@/lib/supabase-admin";
import { normalizeWhatsAppDigits, verifyWhatsAppOtpHash } from "@/lib/whatsapp-otp";

export const maxDuration = 30;

const jsonError = (message: string, status: number) => Response.json({ error: message }, { status });

export async function POST(request: Request) {
  let body: { eventId?: string; phone?: string; code?: string };
  try { body = await request.json() as typeof body; }
  catch { return jsonError("The request body was not valid JSON.", 400); }

  if (!body.eventId || typeof body.phone !== "string" || typeof body.code !== "string") {
    return jsonError("Event, WhatsApp number, and verification code are required.", 400);
  }
  const phone = normalizeWhatsAppDigits(body.phone);
  const code = body.code.trim();
  if (!phone) return jsonError("Enter a valid WhatsApp number with country code.", 400);
  if (!/^\d{6}$/.test(code)) return jsonError("Enter the six-digit code sent to WhatsApp.", 400);

  let admin;
  try { admin = createAdminClient(); }
  catch { return jsonError("WhatsApp verification is temporarily unavailable.", 503); }

  const { data: challenge, error } = await admin.from("whatsapp_otp_challenges")
    .select("id, code_hash, expires_at, attempts, verified_at")
    .eq("event_id", body.eventId)
    .eq("phone", phone)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return jsonError("Could not verify the code. Please request a new one.", 500);
  if (!challenge || new Date(challenge.expires_at).getTime() <= Date.now()) {
    return jsonError("That code has expired. Request a new WhatsApp code.", 400);
  }
  if (challenge.verified_at) return Response.json({ verified: true });
  if (challenge.attempts >= 5) return jsonError("Too many incorrect attempts. Request a new code.", 429);

  const matches = verifyWhatsAppOtpHash(code, body.eventId, phone, challenge.code_hash);
  if (!matches) {
    await admin.from("whatsapp_otp_challenges")
      .update({ attempts: challenge.attempts + 1 })
      .eq("id", challenge.id)
      .is("verified_at", null)
      .is("consumed_at", null);
    return jsonError("That code is incorrect. Check the WhatsApp message and try again.", 400);
  }

  const { data: updated, error: updateError } = await admin.from("whatsapp_otp_challenges")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", challenge.id)
    .is("verified_at", null)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  if (updateError || !updated) return jsonError("This code could not be confirmed. Request a new one.", 409);
  return Response.json({ verified: true });
}
