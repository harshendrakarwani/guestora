import { createAdminClient } from "@/lib/supabase-admin";
import { getRequestUser } from "@/lib/request-auth";
import { createRazorpayOrder, getRazorpayConfig } from "@/lib/razorpay-server";

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Sign in with your organizer account." }, { status: 401 });
  let body: { eventId?: string };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body.eventId) return Response.json({ error: "Event is required." }, { status: 400 });
  let admin;
  try { admin = createAdminClient(); } catch { return Response.json({ error: "Supabase server credentials are missing." }, { status: 503 }); }
  const { data: event, error } = await admin.from("events")
    .select("id, title, status, listing_fee_status, razorpay_listing_order_id")
    .eq("id", body.eventId).eq("organizer_id", user.id).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!event) return Response.json({ error: "Event not found." }, { status: 404 });
  if (event.listing_fee_status === "paid") return Response.json({ error: "The listing fee has already been paid." }, { status: 409 });
  if (event.status !== "draft") return Response.json({ error: "Only draft events can be published." }, { status: 409 });
  const config = getRazorpayConfig();
  if (!config) return Response.json({ error: "Razorpay is not configured for this environment yet." }, { status: 503 });
  try {
    const order = event.razorpay_listing_order_id
      ? { id: event.razorpay_listing_order_id, amount: 25000, currency: "INR" }
      : await createRazorpayOrder({ amount: 25000, applicationId: event.id, eventTitle: `Event listing: ${event.title}` });
    const { error: saveError } = await admin.from("events").update({ razorpay_listing_order_id: order.id }).eq("id", event.id);
    if (saveError) throw new Error(`Could not attach payment to this event: ${saveError.message}`);
    return Response.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: config.keyId,
      name: "Guestora", description: `Non-refundable event listing fee · ${event.title}` });
  } catch (caught) { return Response.json({ error: caught instanceof Error ? caught.message : "Unable to start checkout." }, { status: 502 }); }
}
