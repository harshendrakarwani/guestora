import { createAdminClient } from "@/lib/supabase-admin";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: "Event details are temporarily unavailable." }, { status: 503 });
  }

  // Public event details are intentionally served only for published, paid listings.
  // This avoids depending on client-side RLS policies for anonymous visitors.
  const { data: event, error } = await admin
    .from("events")
    .select("id, title, venue_name, city, state, description, capacity, status, listing_fee_status, application_opens_at, application_closes_at, application_link_closes_at, entry_starts_at, entry_deadline, entry_closed_at")
    .eq("id", id)
    .maybeSingle();

  if (error) return Response.json({ error: "Could not load event details." }, { status: 500 });
  if (!event || event.status !== "published" || event.listing_fee_status !== "paid") {
    return Response.json({ error: "This event was not found or is not published." }, { status: 404 });
  }

  const publicEvent = {
    id: event.id,
    title: event.title,
    venue_name: event.venue_name,
    city: event.city,
    state: event.state,
    description: event.description,
    capacity: event.capacity,
    status: event.status,
    application_opens_at: event.application_opens_at,
    application_closes_at: event.application_closes_at,
    application_link_closes_at: event.application_link_closes_at,
    entry_starts_at: event.entry_starts_at,
    entry_deadline: event.entry_deadline,
    entry_closed_at: event.entry_closed_at,
  };
  return Response.json({ event: publicEvent }, {
    headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" },
  });
}
