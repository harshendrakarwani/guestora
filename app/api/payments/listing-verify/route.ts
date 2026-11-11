import { createAdminClient } from "@/lib/supabase-admin";
import { getRequestUser } from "@/lib/request-auth";
import { getRazorpayPayment, verifyCheckoutSignature } from "@/lib/razorpay-server";

type Body = { eventId?: string; razorpay_order_id?: string; razorpay_payment_id?: string; razorpay_signature?: string };
export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Sign in with your organizer account." }, { status: 401 });
  let body: Body;
  try { body = await request.json() as Body; } catch { return Response.json({ error: "Invalid payment response." }, { status: 400 }); }
  const { eventId, razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = body;
  if (!eventId || !orderId || !paymentId || !signature) return Response.json({ error: "Payment response is incomplete." }, { status: 400 });
  if (!verifyCheckoutSignature(orderId, paymentId, signature)) return Response.json({ error: "Razorpay could not verify this payment." }, { status: 400 });
  let admin;
  try { admin = createAdminClient(); } catch { return Response.json({ error: "Supabase server credentials are missing." }, { status: 503 }); }
  const { data: event, error } = await admin.from("events").select("id, status, listing_fee_status, razorpay_listing_order_id")
    .eq("id", eventId).eq("organizer_id", user.id).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!event || event.razorpay_listing_order_id !== orderId) return Response.json({ error: "Payment does not match this event." }, { status: 409 });
  const payment = await getRazorpayPayment(paymentId);
  if (payment.order_id !== orderId || payment.amount !== 25000 || payment.currency !== "INR") return Response.json({ error: "Payment amount does not match the ₹250 listing fee." }, { status: 409 });
  if (!(payment.status === "captured" || payment.captured === true)) return Response.json({ error: "Payment has not been captured yet." }, { status: 409 });
  if (event.listing_fee_status === "paid" && event.status === "published") return Response.json({ paid: true });
  const { error: publishError } = await admin.from("events").update({
    listing_fee_status: "paid", listing_fee_paise: 25000, razorpay_listing_payment_id: paymentId, status: "published",
  }).eq("id", eventId).eq("organizer_id", user.id).eq("status", "draft");
  if (publishError) return Response.json({ error: `Payment verified but publishing failed: ${publishError.message}` }, { status: 500 });
  return Response.json({ paid: true, message: "Listing fee paid. Your event is now published." });
}
