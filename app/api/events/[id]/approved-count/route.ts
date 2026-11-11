import { createAdminClient } from "@/lib/supabase-admin";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: "Event details are temporarily unavailable." }, { status: 503 });
  }

  const { data: event, error: eventError } = await admin
    .from("events")
    .select("id, capacity, status, listing_fee_status")
    .eq("id", id)
    .maybeSingle();
  if (eventError) return Response.json({ error: "Could not load event details." }, { status: 500 });
  if (!event || event.status !== "published" || event.listing_fee_status !== "paid") {
    return Response.json({ error: "Event not found." }, { status: 404 });
  }

  const { count, error: countError } = await admin
    .from("guest_applications")
    .select("id", { count: "exact", head: true })
    .eq("event_id", id)
    .eq("status", "approved");
  if (countError) return Response.json({ error: "Could not load approved guest count." }, { status: 500 });

  return Response.json({ approvedCount: count ?? 0, capacity: event.capacity ?? 200 }, {
    headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=45" },
  });
}
