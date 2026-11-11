import { createAdminClient } from "@/lib/supabase-admin";

export const revalidate = 30;

export async function GET() {
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: "Events are temporarily unavailable." }, { status: 503 });
  }

  // Only expose fields intended for the public listing, and never rely on an
  // anonymous browser query against the private events table.
  const { data, error } = await admin
    .from("events")
    .select("id, title, venue_name, city, state, description, capacity, application_opens_at, application_closes_at, application_link_closes_at, entry_starts_at, entry_deadline, entry_closed_at, created_at")
    .eq("status", "published")
    .eq("listing_fee_status", "paid")
    .order("created_at", { ascending: false });

  if (error) return Response.json({ error: "Could not load events." }, { status: 500 });

  return Response.json({ events: data ?? [] }, {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
  });
}
