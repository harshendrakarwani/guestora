import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase-admin";
import { normalizeWhatsAppDigits } from "@/lib/whatsapp-otp";
import { getRequestUser } from "@/lib/request-auth";
import { createRazorpayOrder, getRazorpayConfig, hashPaymentAccessToken } from "@/lib/razorpay-server";
import { hasAccountRole } from "@/lib/account-roles";
import { RESUMABLE_PAYMENT_STATES } from "@/lib/payment-safety";
import { APPLICATION_FEE_PAISE } from "@/lib/payment-pricing";

export const maxDuration = 60;

type Body = { eventId?: string; guestMode?: boolean; guestName?: string; guestEmail?: string; guestPhone?: string; instagramUsername?: string };
const error = (message: string, status: number) => Response.json({ error: message }, { status });

export async function POST(request: Request) {
  if (!getRazorpayConfig()) return error("Razorpay test keys are not configured yet.", 503);
  let body: Body;
  try { body = await request.json() as Body; } catch { return error("The request body was not valid JSON.", 400); }
  if (!body.eventId || !body.guestPhone) return error("Event and WhatsApp details are required.", 400);
  const guestMode = body.guestMode === true;
  let user = null;
  if (!guestMode) {
    try { user = await getRequestUser(request); }
    catch (caught) { return error(caught instanceof Error ? caught.message : "Unable to verify your account.", 503); }
    if (!user) return error("Sign in again or choose to continue as a guest.", 401);
    if (!hasAccountRole(user.user_metadata, "guest")) return error("Open the guest workspace with this account before applying.", 403);
    if (!user.email) return error("Your account needs an email address to apply.", 400);
  }
  const guestEmail = guestMode ? body.guestEmail?.trim().toLowerCase() ?? "" : user!.email!.toLowerCase();
  let guestName = body.guestName?.trim() ?? "";
  if (guestMode && (guestName.length < 2 || guestName.length > 120)) return error("Enter your full name.", 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail) || guestEmail.length > 254) return error("Enter a valid email address.", 400);
  const digits = normalizeWhatsAppDigits(body.guestPhone);
  if (!digits) return error("Enter a valid WhatsApp number with country code.", 400);
  const phone = `+${digits}`;
  const instagramUsername = (body.instagramUsername ?? (guestMode ? "" : String(user?.user_metadata?.instagram_username ?? "")))
    .trim().replace(/^@/, "");
  let avatarUrl = guestMode ? "" : String(user?.user_metadata?.avatar_url ?? "").trim();
  if (instagramUsername && !/^[A-Za-z0-9._]{1,30}$/.test(instagramUsername)) {
    return error("Enter a valid Instagram username (letters, numbers, periods, or underscores; up to 30 characters).", 400);
  }

  let admin;
  try { admin = createAdminClient(); } catch { return error("Supabase server credentials are missing. Add the service-role key in Vercel.", 503); }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const allowedAvatarPrefix = user && supabaseUrl
    ? `${supabaseUrl}/storage/v1/object/public/guest-avatars/${user.id}/`
    : "";
  if (!allowedAvatarPrefix || !avatarUrl.startsWith(allowedAvatarPrefix)) avatarUrl = "";
  if (!guestMode) {
    const { data: profile } = await admin.from("profiles").select("full_name").eq("id", user!.id).maybeSingle();
    guestName = String(user!.user_metadata?.full_name ?? user!.user_metadata?.name ?? "").trim() || profile?.full_name?.trim() || guestEmail.split("@")[0];
  }
  const { data: event, error: eventError } = await admin.from("events")
    .select("id, title, status, application_opens_at, application_link_closes_at, listing_fee_status")
    .eq("id", body.eventId).maybeSingle();
  if (eventError) return error(`Could not load event: ${eventError.message}`, 500);
  if (!event || event.status !== "published" || event.listing_fee_status !== "paid") return error("This event is not available for applications.", 404);
  if (event.application_opens_at && new Date(event.application_opens_at).getTime() > Date.now()) return error(`Guest list registration opens at ${new Date(event.application_opens_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}.`, 409);
  if (event.application_link_closes_at && new Date(event.application_link_closes_at).getTime() <= Date.now()) return error("Event guestlist registrations have now been closed.", 409);
  const { data: duplicateIdentityId, error: identityLookupError } = await admin.rpc("find_duplicate_guest_application", {
    p_event_id: event.id,
    p_guest_email: guestEmail,
    p_guest_phone: phone,
  });
  if (identityLookupError) return error("Could not check whether you have already applied.", 500);
  if (duplicateIdentityId) {
    return Response.json({
      alreadySubmitted: true,
      applicationId: duplicateIdentityId,
      message: "An application has already been submitted using this email.",
    }, { status: 409 });
  }

  const { data: verifiedChallenge, error: otpError } = await admin.from("whatsapp_otp_challenges")
    .select("id")
    .eq("event_id", event.id)
    .eq("phone", digits)
    .not("verified_at", "is", null)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (otpError) return error("Could not verify your WhatsApp number. Please try again.", 500);
  if (!verifiedChallenge) return error("Verify this WhatsApp number with the code we sent before continuing.", 403);

  const paymentAccessToken = guestMode ? randomBytes(32).toString("hex") : null;
  let activeIntentQuery = admin.from("guest_payment_intents")
    .select("id, guest_id, razorpay_order_id, amount_paise, payment_status, applicant_data")
    .eq("event_id", event.id)
    .filter("applicant_data->>email", "eq", guestEmail)
    .in("payment_status", [...RESUMABLE_PAYMENT_STATES])
    .order("created_at", { ascending: false })
    .limit(1);
  activeIntentQuery = guestMode
    ? activeIntentQuery.is("guest_id", null)
    : activeIntentQuery.eq("guest_id", user!.id);
  const { data: activeIntent, error: activeIntentError } = await activeIntentQuery.maybeSingle();
  if (activeIntentError) return error(`Could not check an existing checkout: ${activeIntentError.message}`, 500);

  if (activeIntent) {
    const savedApplicantData = (activeIntent.applicant_data ?? {}) as Record<string, unknown>;
    const existingPhone = normalizeWhatsAppDigits(String(savedApplicantData.phone ?? ""));
    if (existingPhone && existingPhone !== digits) {
      return error("A checkout using this email is already active with another WhatsApp number. Continue that checkout; no second payment was created.", 409);
    }
    const { error: markVerifiedError } = await admin.from("guest_payment_intents")
      .update({ applicant_data: { ...savedApplicantData, instagram_username: instagramUsername, ...(avatarUrl ? { avatar_url: avatarUrl } : {}), whatsapp_verified_at: new Date().toISOString() } })
      .eq("id", activeIntent.id);
    if (markVerifiedError) return error("Could not confirm the verified number on your checkout. Please try again.", 500);
    const { error: consumeOtpError } = await admin.from("whatsapp_otp_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", verifiedChallenge.id)
      .is("consumed_at", null);
    if (consumeOtpError) return error("Your number was verified, but the checkout could not be resumed. Try again.", 500);
    if (!activeIntent.razorpay_order_id) {
      return error("Your checkout is already being prepared. Wait a moment and try again; do not start another payment.", 409);
    }
    const config = getRazorpayConfig();
    if (!config) return error("Razorpay is not configured on the server.", 503);
    let paymentResponse: Response;
    try {
      paymentResponse = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(activeIntent.razorpay_order_id)}/payments`, {
        headers: { Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}` },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      return error("Could not check your existing Razorpay checkout. Do not pay again; refresh payment status shortly.", 502);
    }
    if (!paymentResponse.ok) return error("Could not check your existing Razorpay checkout. Do not pay again; refresh payment status shortly.", 502);
    const paymentData = await paymentResponse.json().catch(() => ({})) as {
      items?: Array<{ id?: string; status?: string; amount?: number; currency?: string }>;
    };
    const captured = paymentData.items?.find((payment) => payment.status === "captured" && payment.id && payment.amount === activeIntent.amount_paise && payment.currency === "INR");
    if (captured) {
      const { data: applicationId, error: finalizeError } = await admin.rpc("finalize_paid_guest_application", {
        p_intent_id: activeIntent.id,
        p_payment_id: captured.id,
      });
      if (finalizeError || !applicationId) return error("Payment was captured and is being finalized. Do not pay again; use Refresh payment status shortly.", 409);
      return Response.json({
        alreadySubmitted: true,
        applicationId,
        message: "Your application is already submitted. Go to your dashboard to check approval status.",
      });
    }

    if (guestMode) {
      const { error: tokenError } = await admin.from("guest_payment_intents")
        .update({ payment_access_token_hash: hashPaymentAccessToken(paymentAccessToken!) })
        .eq("id", activeIntent.id);
      if (tokenError) return error("Could not securely resume your existing checkout. Do not start another payment; contact support.", 500);
    }
    return Response.json({
      intentId: activeIntent.id,
      paymentAccessToken,
      orderId: activeIntent.razorpay_order_id,
      amount: activeIntent.amount_paise,
      currency: "INR",
      keyId: config.keyId,
      name: "Guestora",
      description: `Guest-list application fee · ${event.title}`,
    });
  }

  const { data: intent, error: intentError } = await admin.from("guest_payment_intents").insert({
    event_id: event.id,
    guest_id: guestMode ? null : user!.id,
    applicant_data: { name: guestName, email: guestEmail, phone, instagram_username: instagramUsername, avatar_url: avatarUrl, whatsapp_verified_at: new Date().toISOString() },
    amount_paise: APPLICATION_FEE_PAISE,
    payment_access_token_hash: paymentAccessToken ? hashPaymentAccessToken(paymentAccessToken) : null,
  }).select("id").single();
  if (intentError?.code === "23505") {
    return error("A duplicate application or checkout already exists for this event using this email. No second payment was created.", 409);
  }
  if (intentError || !intent) return error(`Could not prepare payment: ${intentError?.message || "Please try again."}`, 400);
  const { error: consumeOtpError } = await admin.from("whatsapp_otp_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", verifiedChallenge.id)
    .is("consumed_at", null);
  if (consumeOtpError) {
    await admin.from("guest_payment_intents").update({ payment_status: "failed" }).eq("id", intent.id);
    return error("Your number was verified, but checkout could not continue. Request a fresh WhatsApp code and try again.", 500);
  }
  try {
    const order = await createRazorpayOrder({ amount: APPLICATION_FEE_PAISE, applicationId: intent.id, eventTitle: event.title });
    const { error: saveError } = await admin.from("guest_payment_intents").update({ razorpay_order_id: order.id }).eq("id", intent.id);
    if (saveError) throw new Error(`Order was created but could not be linked: ${saveError.message}`);
    const config = getRazorpayConfig()!;
    return Response.json({ intentId: intent.id, paymentAccessToken, orderId: order.id, amount: order.amount,
      currency: order.currency, keyId: config.keyId, name: "Guestora", description: `Guest-list application fee · ${event.title}` });
  } catch (caught) {
    await admin.from("guest_payment_intents").update({ payment_status: "failed" }).eq("id", intent.id);
    return error(caught instanceof Error ? caught.message : "Unable to start payment.", 502);
  }
}
