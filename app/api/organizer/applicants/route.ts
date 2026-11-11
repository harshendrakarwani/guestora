import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";

const pageSize = 500;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const requestedEventId = new URL(request.url).searchParams.get("eventId");
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

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    // Fall back to the organizer's authenticated access so the list remains
    // available when a service-role key has not been configured.
    admin = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  const { data: events, error: eventsError } = await admin
    .from("events")
    .select("id, title, venue_name, city, state")
    .eq("organizer_id", authData.user.id);
  if (eventsError) return jsonError(`Could not load your events: ${eventsError.message}`, 500);

  const eventRecords = events ?? [];
  if (!eventRecords.length) return Response.json({ events: [], applicants: [] });

  // The all-applicants view is event-scoped. A requested event must belong to
  // the signed-in organizer before any application rows are returned.
  if (requestedEventId && !eventRecords.some((event) => event.id === requestedEventId)) {
    return jsonError("That event was not found in your organizer workspace.", 404);
  }
  // On the initial page visit, return the first event's applicants in the same
  // request as the event list. The previous client flow made two full trips.
  const selectedEventId = requestedEventId || eventRecords[0].id;
  const visibleEvents = eventRecords.filter((event) => event.id === selectedEventId);
  if (!visibleEvents.length) return Response.json({ events: eventRecords, applicants: [], selectedEventId });

  const eventById = new Map(visibleEvents.map((event) => [event.id, event]));
  const allApplications: Array<Record<string, unknown> & { guest_id: string | null; event_id: string }> = [];

  for (let start = 0; ; start += pageSize) {
    const { data, error } = await admin
      .from("guest_applications")
      .select("id, event_id, guest_id, guest_name, guest_email, guest_phone, instagram_username, guest_avatar_url, status, auto_rejected, application_fee_paise, payment_status, checked_in_at, created_at, reviewed_at, whatsapp_pass_sent_at, whatsapp_delivery_status, whatsapp_status_updated_at, whatsapp_delivery_error")
      .in("event_id", visibleEvents.map((event) => event.id))
      .order("created_at", { ascending: false })
      .range(start, start + pageSize - 1);
    if (error) return jsonError(`Could not load applicants: ${error.message}`, 500);
    const page = (data ?? []) as typeof allApplications;
    allApplications.push(...page);
    if (page.length < pageSize) break;
  }

  const guestIds = [...new Set(allApplications
    .filter((application) => !(typeof application.guest_name === "string" && application.guest_name.trim()))
    .map((application) => application.guest_id)
    .filter((id): id is string => Boolean(id)))];
  const namesByGuestId = new Map<string, string>();
  for (let start = 0; start < guestIds.length; start += pageSize) {
    const ids = guestIds.slice(start, start + pageSize);
    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", ids);
    // Some projects restrict profile reads to the profile owner. In that case
    // keep the applications visible and use the email-based fallback in the UI.
    if (profilesError) continue;
    for (const profile of profiles ?? []) {
      if (profile.full_name?.trim()) namesByGuestId.set(profile.id, profile.full_name.trim());
    }
  }

  const applicants = allApplications.flatMap((application) => {
    const event = eventById.get(application.event_id);
    if (!event) return [];
    return [{
      ...application,
      guest_name: application.guest_name || (application.guest_id ? namesByGuestId.get(application.guest_id) ?? null : null),
      event,
    }];
  });

  return Response.json({ events: eventRecords, applicants, selectedEventId });
}
