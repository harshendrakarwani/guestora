import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const COOKIE_NAME = "guestora_guest_dashboard";
// The emailed link can be used again at any time. Each claim refreshes the
// browser session; the session cookie itself remains bounded to 30 days.
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "This dashboard link is invalid or has been replaced." }, { status: 403 });
  }
  let body: { token?: unknown };
  try { body = await request.json() as { token?: unknown }; }
  catch { return Response.json({ error: "This dashboard link is invalid or has been replaced." }, { status: 400 }); }
  if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token)) {
    return Response.json({ error: "This dashboard link is invalid or has been replaced." }, { status: 400 });
  }
  let admin;
  try { admin = createAdminClient(); }
  catch { return Response.json({ error: "Guest dashboard access is temporarily unavailable." }, { status: 503 }); }

  const sessionToken = randomBytes(32).toString("hex");
  const sessionExpiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
  const { data: phone, error } = await admin.rpc("claim_guest_dashboard_access_link", {
    p_token_hash: sha256(body.token),
    p_session_hash: sha256(sessionToken),
    p_session_expires_at: sessionExpiresAt,
  });
  if (error) {
    console.error("Guest dashboard link claim failed", { code: error.code });
    return Response.json({ error: "Guest dashboard access is temporarily unavailable." }, { status: 503 });
  }
  if (typeof phone !== "string") return Response.json({ error: "This dashboard link is invalid or has been replaced. Request a new link if needed." }, { status: 410 });

  const response = NextResponse.json({ claimed: true });
  response.cookies.set(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
