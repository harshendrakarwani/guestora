import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";
import { canClaimPassSend } from "@/lib/payment-safety";

export const maxDuration = 60;

type MetaSendResponse = {
  messages?: Array<{ id?: string }>;
  error?: { message?: string };
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function formatIndianDate(value: string | null): string {
  if (!value) return "Not specified";
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return jsonError("Please sign in again.", 401);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    return jsonError("Supabase is not configured on the server.", 500);
  }

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !authData.user) return jsonError("Please sign in again.", 401);

  let body: { applicationId?: string; force?: boolean };
  try {
    body = await request.json();
  } catch {
    return jsonError("The request body was not valid JSON.", 400);
  }
  if (!body.applicationId) return jsonError("An application ID is required.", 400);

  const accessTokenForMessage = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_API_VERSION;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
  const qrTemplateName = process.env.WHATSAPP_QR_TEMPLATE_NAME;
  const templateLanguage = process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en";
  const qrTemplateLanguage = process.env.WHATSAPP_QR_TEMPLATE_LANGUAGE || templateLanguage;

  if (!accessTokenForMessage || !phoneNumberId || !apiVersion || !templateName) {
    return jsonError(
      "WhatsApp delivery is not configured yet. Add the Meta Cloud API settings to the server environment.",
      503
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Supabase server credentials are missing.",
      503
    );
  }

  const { data: application, error: applicationError } = await admin
    .from("guest_applications")
    .select(
      "id, event_id, guest_id, guest_name, guest_email, guest_phone, status, check_in_token, whatsapp_pass_sent_at, whatsapp_delivery_status"
    )
    .eq("id", body.applicationId)
    .maybeSingle();

  if (applicationError) {
    return jsonError(`Could not load this application: ${applicationError.message}`, 500);
  }
  if (!application) return jsonError("Application not found.", 404);
  if (application.status !== "approved") {
    return jsonError("Approve the application before sending its pass.", 409);
  }
  if (!application.guest_phone) {
    return jsonError("This guest has not provided a WhatsApp number.", 400);
  }
  if (!application.check_in_token) {
    return jsonError("This application does not have a check-in QR yet.", 409);
  }
  if (application.whatsapp_pass_sent_at && !body.force) {
    return Response.json({
      sent: true,
      alreadySent: true,
      message: "The pass was already accepted by WhatsApp. Use Resend to send it again.",
    });
  }
  if (!canClaimPassSend(application.whatsapp_delivery_status)) {
    return jsonError("A pass message is already being sent. Refresh the applicant list before retrying.", 409);
  }

  const { data: event, error: eventError } = await admin
    .from("events")
    .select("id, organizer_id, title, application_closes_at, entry_starts_at")
    .eq("id", application.event_id)
    .maybeSingle();

  if (eventError) return jsonError(`Could not load event details: ${eventError.message}`, 500);
  if (!event || event.organizer_id !== authData.user.id) {
    return jsonError("You can only send passes for your own events.", 403);
  }
  if (application.guest_id === authData.user.id) {
    return jsonError("Sign in with the organizer account for this event.", 403);
  }

  const phone = String(application.guest_phone).replace(/\D/g, "");
  if (phone.length < 8 || phone.length > 15) {
    return jsonError("The saved WhatsApp number is not valid. Ask the guest to update it.", 400);
  }

  const guestName = application.guest_name?.trim() || application.guest_email?.split("@")[0] || "Guest";

  const templateParameters = [
    guestName,
    event.title,
    formatIndianDate(event.application_closes_at),
    formatIndianDate(event.entry_starts_at),
  ].map((text) => ({ type: "text", text }));

  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin
    .from("guest_applications")
    .update({
      whatsapp_delivery_status: "sending",
      whatsapp_status_updated_at: claimedAt,
      whatsapp_delivery_error: null,
    })
    .eq("id", application.id)
    .or("whatsapp_delivery_status.is.null,whatsapp_delivery_status.neq.sending")
    .select("id")
    .maybeSingle();
  if (claimError) return jsonError("Could not reserve pass delivery. Please try again.", 500);
  if (!claimed) return jsonError("A pass message is already being sent. Refresh the applicant list before retrying.", 409);

  let metaResponse: Response;
  try {
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
    const templateComponents = [
      ...(qrTemplateName
        ? [{
            type: "header",
            parameters: [{
              type: "image",
              image: { link: `${siteUrl}/api/pass-qr/${application.check_in_token}` },
            }],
          }]
        : []),
      { type: "body", parameters: templateParameters },
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: application.check_in_token }],
      },
    ];
    metaResponse = await fetch(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessTokenForMessage}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phone,
          type: "template",
          template: {
            name: qrTemplateName || templateName,
            language: { code: qrTemplateName ? qrTemplateLanguage : templateLanguage },
            components: templateComponents,
          },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      }
    );
  } catch {
    // The provider may have accepted the message before the connection timed
    // out. Keep the sending lock to prevent accidental duplicate passes.
    return jsonError("Could not reach the WhatsApp Cloud API. Please try again.", 502);
  }

  const metaResult = (await metaResponse.json().catch(() => ({}))) as MetaSendResponse;
  if (!metaResponse.ok) {
    const sentAt = new Date().toISOString();
    await admin.from("guest_applications").update({
      whatsapp_delivery_status: "failed",
      whatsapp_status_updated_at: sentAt,
      whatsapp_delivery_error: metaResult.error?.message || "WhatsApp rejected the pass message.",
    }).eq("id", application.id).eq("whatsapp_delivery_status", "sending");
    return jsonError(
      metaResult.error?.message || "WhatsApp could not accept this pass message.",
      502
    );
  }

  const messageId = metaResult.messages?.[0]?.id;
  if (!messageId) {
    // Missing provider message ID is ambiguous: do not release the lock and
    // risk sending a second pass if Meta actually accepted the first.
    return jsonError("WhatsApp returned no message ID, so the pass could not be confirmed.", 502);
  }

  const sentAt = new Date().toISOString();
  const { error: saveError } = await admin
    .from("guest_applications")
    .update({
      whatsapp_pass_sent_at: sentAt,
      whatsapp_message_id: messageId,
      whatsapp_delivery_status: "accepted",
      whatsapp_status_updated_at: sentAt,
      whatsapp_delivery_error: null,
    })
    .eq("id", application.id);

  if (saveError) {
    return jsonError(
      "WhatsApp accepted the message, but Guestora could not save its delivery record.",
      500
    );
  }

  return Response.json({
    sent: true,
    message: "Pass sent on WhatsApp.",
  });
}
