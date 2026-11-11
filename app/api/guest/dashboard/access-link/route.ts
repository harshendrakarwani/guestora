import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase-admin";
import { hashWhatsAppOtpIp, normalizeWhatsAppDigits } from "@/lib/whatsapp-otp";

const genericResponse = () => Response.json({ sent: true }, { headers: { "Cache-Control": "no-store" } });
const errorResponse = (message: string, status: number) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character] ?? character));

type ResendResponse = { id?: string; message?: string; name?: string };

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return errorResponse("Request could not be completed.", 403);

  let body: { email?: unknown };
  try { body = await request.json() as { email?: unknown }; }
  catch { return errorResponse("Enter a valid email address.", 400); }
  if (typeof body.email !== "string") return errorResponse("Enter a valid email address.", 400);
  const email = body.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errorResponse("Enter a valid email address.", 400);

  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!resendApiKey || !fromEmail) return errorResponse("Email dashboard links are not configured yet.", 503);

  let admin;
  try { admin = createAdminClient(); }
  catch { return errorResponse("Guest dashboard access is temporarily unavailable.", 503); }

  // A link sent to an email only opens guest-mode applications belonging to
  // that email. It never grants access to other applicants sharing a phone.
  const { data: applications, error: applicationError } = await admin.from("guest_applications")
    .select("id, guest_name, guest_phone")
    .is("guest_id", null)
    .eq("guest_email", email)
    .order("created_at", { ascending: false })
    .limit(1);
  if (applicationError) {
    console.error("Guest dashboard email lookup failed", { code: applicationError.code });
    return errorResponse("Guest dashboard access is temporarily unavailable.", 503);
  }
  if (!applications?.length) return genericResponse();

  const phone = normalizeWhatsAppDigits(String(applications[0].guest_phone ?? ""));
  if (!phone) return genericResponse();

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const ipHash = hashWhatsAppOtpIp(ip);
  const token = randomBytes(32).toString("hex");
  const tokenHash = sha256(token);
  const { data: allowed, error: limitError } = await admin.rpc("create_guest_dashboard_email_link", {
    p_email: email,
    p_phone: phone,
    p_request_ip_hash: ipHash,
    p_token_hash: tokenHash,
    p_expires_at: "infinity",
  });
  if (limitError) {
    console.error("Guest dashboard email request could not be recorded", { code: limitError.code });
    return errorResponse("Guest dashboard access is temporarily unavailable.", 503);
  }
  if (allowed !== true) return errorResponse("Too many link requests. Please try again later.", 429);

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
  const accessUrl = `${siteUrl}/dashboard/access/claim/${token}`;
  const guestName = escapeHtml(String(applications[0].guest_name || "Guest"));
  let resendResponse: Response;
  try {
    resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject: "Your secure Guestora dashboard link",
        text: `Hi ${applications[0].guest_name || "Guest"},\n\nUse this secure link to view guest applications associated with this email address: ${accessUrl}\n\nThis link does not expire and can be used again. Anyone with access to this email inbox can open it. Requesting a new dashboard link will disable this one. If you did not request it, you can ignore this email.`,
        html: `<p>Hi ${guestName},</p><p>Use this secure link to view guest applications associated with this email address:</p><p><a href="${accessUrl}">Open your Guestora dashboard</a></p><p>This link does not expire and can be used again. Anyone with access to this email inbox can open it. Requesting a new dashboard link will disable this one.</p><p>If you did not request it, you can ignore this email.</p>`,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    // A timeout can happen after Resend accepts the message. Keep the token
    // briefly valid to avoid breaking a message that arrives late.
    return genericResponse();
  }

  const resendResult = await resendResponse.json().catch(() => ({})) as ResendResponse;
  if (!resendResponse.ok || !resendResult.id) {
    await admin.from("guest_dashboard_access_links").update({ revoked_at: new Date().toISOString() }).eq("token_hash", tokenHash);
    console.error("Resend rejected the guest dashboard link email", { message: resendResult.message || resendResult.name || "No message ID" });
    return errorResponse("Email could not send the link. Please try again later.", 502);
  }

  return genericResponse();
}
