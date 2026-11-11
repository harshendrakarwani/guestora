import { createClient } from "@supabase/supabase-js";
import { hasAccountRole } from "@/lib/account-roles";
import { createAdminClient } from "@/lib/supabase-admin";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function DELETE(request: Request) {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return jsonError("Please sign in again.", 401);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) return jsonError("Supabase is not configured on the server.", 500);

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !authData.user) return jsonError("Please sign in again.", 401);
  if (!hasAccountRole(authData.user.user_metadata, "organizer")) {
    return jsonError("Organizer access is required to delete events.", 403);
  }

  const body = await request.json().catch(() => null) as { eventId?: unknown } | null;
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  if (!eventId) return jsonError("Choose a draft event to delete.", 400);

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return jsonError("Event deletion is unavailable because server database access is not configured.", 500);
  }

  const { data: event, error: eventError } = await admin
    .from("events")
    .select("id, razorpay_listing_order_id, razorpay_listing_payment_id")
    .eq("id", eventId)
    .eq("organizer_id", authData.user.id)
    .eq("status", "draft")
    .maybeSingle();
  if (eventError) return jsonError("Could not verify this draft event.", 500);
  if (!event) return jsonError("Only your own draft events can be deleted.", 404);
  if (event.razorpay_listing_payment_id) {
    return jsonError("This draft has a completed Razorpay payment recorded, so it cannot be deleted.", 409);
  }

  const { count: applicationCount, error: applicationsError } = await admin
    .from("guest_applications")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);
  if (applicationsError) return jsonError("Could not check for guest applications. The draft was not deleted.", 500);
  if ((applicationCount ?? 0) > 0) {
    return jsonError("This draft has guest applications, so it cannot be deleted. Keep it as a draft to preserve those records.", 409);
  }

  const { count: intentCount, error: intentsError } = await admin
    .from("guest_payment_intents")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);
  if (intentsError) return jsonError("Could not check for payment activity. The draft was not deleted.", 500);
  if ((intentCount ?? 0) > 0) {
    return jsonError("This draft has guest payment activity, so it cannot be deleted. Keep it as a draft to preserve those records.", 409);
  }

  const { data: deleted, error: deleteError } = await admin
    .from("events")
    .delete()
    .eq("id", eventId)
    .eq("organizer_id", authData.user.id)
    .eq("status", "draft")
    .is("razorpay_listing_payment_id", null)
    .select("id")
    .maybeSingle();
  if (deleteError) {
    console.error("Organizer draft deletion failed", {
      eventId,
      code: deleteError.code,
      message: deleteError.message,
      details: deleteError.details,
      hint: deleteError.hint,
    });
    return jsonError(`Could not delete this draft event: ${deleteError.message} (Code: ${deleteError.code}).`, 500);
  }
  if (!deleted) return jsonError("This draft changed before it could be deleted. Refresh and try again.", 409);

  return Response.json({ success: true });
}
