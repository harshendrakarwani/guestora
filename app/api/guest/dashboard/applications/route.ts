import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase-admin";

const COOKIE_NAME = "guestora_guest_dashboard";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const jsonError = (message: string, status: number) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(COOKIE_NAME)?.value;
  if (!sessionToken || !/^[a-f0-9]{64}$/.test(sessionToken)) return jsonError("Dashboard session expired. Request a new email link.", 401);
  let admin;
  try { admin = createAdminClient(); }
  catch { return jsonError("Guest dashboard is temporarily unavailable.", 503); }

  const { data: session, error: sessionError } = await admin.from("guest_dashboard_access_links")
    .select("phone, guest_email")
    .eq("session_hash", sha256(sessionToken))
    .is("revoked_at", null)
    .gt("session_expires_at", new Date().toISOString())
    .maybeSingle();
  if (sessionError) {
    console.error("Guest dashboard session lookup failed", { code: sessionError.code });
    return jsonError("Guest dashboard is temporarily unavailable.", 503);
  }
  if (!session) return jsonError("Dashboard session expired. Request a new email link.", 401);

  const phone = String(session.phone);
  const email = typeof session.guest_email === "string" ? session.guest_email : null;
  const phoneVariants = [...new Set([phone, `+${phone}`, ...(phone.startsWith("91") && phone.length === 12 ? [phone.slice(2), `+91${phone.slice(2)}`] : [])])];
  let query = admin.from("guest_applications")
    .select("id, event_id, guest_name, guest_email, guest_phone, instagram_username, guest_avatar_url, status, application_fee_paise, payment_status, check_in_token, created_at, events(title, venue_name, city, state)")
    .is("guest_id", null)
    .order("created_at", { ascending: false })
    .limit(200);
  query = email ? query.eq("guest_email", email) : query.in("guest_phone", phoneVariants);
  const { data: applications, error } = await query;
  if (error) {
    console.error("Guest dashboard applications query failed", { code: error.code });
    return jsonError("Could not load your applications. Refresh and try again.", 500);
  }

  const response = Response.json({ email, phone: email ? undefined : phone, applications: applications ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
