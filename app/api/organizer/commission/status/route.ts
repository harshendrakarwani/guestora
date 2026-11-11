import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return Response.json({ error: "Please sign in again." }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase is not configured." }, { status: 500 });
  const auth = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return Response.json({ error: "Please sign in again." }, { status: 401 });
  try {
    const admin = createAdminClient();
    const { data: claims, error: claimsError } = await admin.from("organizer_commission_claims")
      .select("event_id, status, paid_at, manual_payment_reference")
      .eq("organizer_id", data.user.id);
    if (claimsError) throw claimsError;
    return Response.json({ claims: (claims ?? []).map((claim) => ({
      eventId: claim.event_id, status: claim.status, paidAt: claim.paid_at, paymentReference: claim.manual_payment_reference,
    })) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Could not load commission status." }, { status: 503 });
  }
}
