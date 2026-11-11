import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";
import { encryptCommissionPayoutDetails } from "@/lib/commission-payout-crypto";

const pageSize = 500;
const applicationChunkSize = 100;
type ApplicationRow = { id: string; status: string; payment_status: string };
type ShareRow = { application_id: string; share_paise: number; payout_status: string };
type ClaimRow = {
  id: string;
  amount_paise: number;
  status: string;
  payout_url: string | null;
  manual_payment_reference: string | null;
  paid_at: string | null;
  created_at: string;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

async function getOrganizerContext(request: Request) {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return { error: jsonError("Please sign in again.", 401) } as const;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) return { error: jsonError("Supabase is not configured on the server.", 500) } as const;
  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: (input, init = {}) => fetch(input, {
      ...init,
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
    }) },
  });
  const { data, error } = await authClient.auth.getUser(accessToken);
  if (error || !data.user) return { error: jsonError("Please sign in again.", 401) } as const;
  try { return { user: data.user, admin: createAdminClient() } as const; }
  catch { return { error: jsonError("Organizer commission is not configured on the server.", 500) } as const; }
}

async function loadCommission(admin: ReturnType<typeof createAdminClient>, eventId: string, organizerId: string) {
  const [eventResult, firstApplicationsResult, claimResult] = await Promise.all([
    admin.from("events").select("id, title, entry_deadline, entry_closed_at")
      .eq("id", eventId).eq("organizer_id", organizerId).maybeSingle(),
    admin.from("guest_applications").select("id, status, payment_status")
      .eq("event_id", eventId).range(0, pageSize - 1),
    admin.from("organizer_commission_claims")
      .select("id, amount_paise, status, payout_url, manual_payment_reference, paid_at, created_at")
      .eq("event_id", eventId).eq("organizer_id", organizerId).maybeSingle(),
  ]);
  if (eventResult.error) throw new Error(`Could not load event: ${eventResult.error.message}`);
  if (!eventResult.data) return { error: "That event was not found in your organizer workspace." } as const;
  if (firstApplicationsResult.error) throw new Error(`Could not calculate event commission: ${firstApplicationsResult.error.message}`);

  const applications = (firstApplicationsResult.data ?? []) as ApplicationRow[];
  for (let start = pageSize; firstApplicationsResult.data?.length === pageSize; start += pageSize) {
    const { data, error } = await admin.from("guest_applications").select("id, status, payment_status")
      .eq("event_id", eventId).range(start, start + pageSize - 1);
    if (error) throw new Error(`Could not calculate event commission: ${error.message}`);
    const page = (data ?? []) as ApplicationRow[];
    applications.push(...page);
    if (page.length < pageSize) break;
  }

  const pendingApplications = applications.filter((application) => application.status === "pending").length;
  const eligible = applications.filter((application) => application.payment_status === "paid" && application.status !== "rejected");
  const shareQueries = [];
  for (let start = 0; start < eligible.length; start += applicationChunkSize) {
    const ids = eligible.slice(start, start + applicationChunkSize).map((application) => application.id);
    shareQueries.push(admin.from("organizer_revenue_shares")
      .select("application_id, share_paise, payout_status")
      .eq("organizer_id", organizerId).in("application_id", ids)
      .in("payout_status", ["pending_route_setup", "ready"]));
  }
  const shares: ShareRow[] = [];
  for (const result of await Promise.all(shareQueries)) {
    if (result.error) throw new Error(`Could not read commission records: ${result.error.message}`);
    shares.push(...((result.data ?? []) as ShareRow[]));
  }
  if (claimResult.error) throw new Error(`Could not load commission claim: ${claimResult.error.message}`);

  const event = eventResult.data;
  const deadline = event.entry_deadline ? new Date(event.entry_deadline).getTime() : null;
  const closedAt = event.entry_closed_at ? new Date(event.entry_closed_at).getTime() : null;
  const availableAt = closedAt ?? deadline;
  const entryClosePending = availableAt !== null && Date.now() < availableAt;
  const available = availableAt !== null && !entryClosePending && pendingApplications === 0 && shares.length > 0;
  return {
    event: { id: event.id, title: event.title, entryDeadline: event.entry_deadline, entryClosedAt: event.entry_closed_at },
    amountPaise: shares.reduce((total, share) => total + Number(share.share_paise || 0), 0),
    eligibleApplications: shares.length,
    pendingApplications,
    entryClosePending,
    availableAt: availableAt === null ? null : new Date(availableAt).toISOString(),
    available,
    claim: (claimResult.data ?? null) as ClaimRow | null,
  } as const;
}

export async function GET(request: Request) {
  const context = await getOrganizerContext(request);
  if ("error" in context) return context.error;
  const eventId = new URL(request.url).searchParams.get("eventId")?.trim();
  if (!eventId) return jsonError("Choose an event first.", 400);
  try {
    const summary = await loadCommission(context.admin, eventId, context.user.id);
    if (!("available" in summary) || !summary.event) return jsonError("error" in summary ? summary.error : "That event was not found in your organizer workspace.", 404);
    return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load commission.", 500);
  }
}

function validatePayoutDetails(body: Record<string, unknown>) {
  const method = body.payoutMethod;
  if (method === "upi") {
    const upiId = typeof body.upiId === "string" ? body.upiId.trim() : "";
    if (upiId.length > 256 || !/^[A-Za-z0-9._-]{2,128}@[A-Za-z0-9.-]{2,64}$/.test(upiId)) {
      return { error: "Enter a valid UPI ID, such as name@bank." } as const;
    }
    return { method, details: { upiId } } as const;
  }
  if (method === "bank") {
    const accountHolder = typeof body.accountHolder === "string" ? body.accountHolder.trim() : "";
    const accountNumber = typeof body.accountNumber === "string" ? body.accountNumber.replace(/\s/g, "") : "";
    const ifsc = typeof body.ifsc === "string" ? body.ifsc.trim().toUpperCase() : "";
    const bankName = typeof body.bankName === "string" ? body.bankName.trim().slice(0, 100) : "";
    if (accountHolder.length < 2 || accountHolder.length > 100) return { error: "Enter the account holder name." } as const;
    if (!/^\d{6,20}$/.test(accountNumber)) return { error: "Enter a valid bank account number." } as const;
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return { error: "Enter a valid 11-character IFSC code." } as const;
    return { method, details: { accountHolder, accountNumber, ifsc, bankName } } as const;
  }
  return { error: "Choose UPI or bank transfer." } as const;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

async function notifyCommissionAdmins(input: { claimId: string; eventTitle: string; organizerName: string; amountPaise: number }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const recipients = (process.env.COMMISSION_ADMIN_EMAILS || "").split(",").map((email) => email.trim()).filter(Boolean);
  if (!apiKey || !from || !recipients.length) return false;
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.guestora.in").replace(/\/$/, "");
  const reviewUrl = `${siteUrl}/organizer/commission/admin?claimId=${encodeURIComponent(input.claimId)}`;
  const amount = `₹${(input.amountPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  const event = escapeHtml(input.eventTitle);
  const organizer = escapeHtml(input.organizerName);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: recipients,
        subject: `Organizer commission claim: ${input.eventTitle}`,
        text: `A manual commission claim is waiting for review.\nEvent: ${input.eventTitle}\nOrganizer: ${input.organizerName}\nAmount: ${amount}\nClaim: ${input.claimId}\nReview securely: ${reviewUrl}\n\nPayout destination details are not included in this email. Sign in to Guestora's admin review page to view them.`,
        html: `<p>A manual commission claim is waiting for review.</p><p><strong>Event:</strong> ${event}<br><strong>Organizer:</strong> ${organizer}<br><strong>Amount:</strong> ${amount}<br><strong>Claim:</strong> ${input.claimId}</p><p><a href="${reviewUrl}">Review claim securely</a></p><p>Payout destination details are not included in this email. Sign in to Guestora to view them.</p>`,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch { return false; }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return jsonError("Request could not be completed.", 403);
  const context = await getOrganizerContext(request);
  if ("error" in context) return context.error;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  if (!eventId) return jsonError("Choose an event first.", 400);
  if (!context.user.email) return jsonError("Your account needs a verified email before submitting a claim.", 400);

  const payout = validatePayoutDetails(body ?? {});
  if (!("details" in payout)) return jsonError(payout.error, 400);
  let encryptedDetails: string;
  try { encryptedDetails = encryptCommissionPayoutDetails(payout.details); }
  catch (error) { return jsonError(error instanceof Error ? error.message : "Secure payout details storage is unavailable.", 503); }

  try {
    const summary = await loadCommission(context.admin, eventId, context.user.id);
    if (!("available" in summary) || !summary.event || typeof summary.pendingApplications !== "number") {
      return jsonError("error" in summary ? summary.error : "That event was not found in your organizer workspace.", 404);
    }
    if (!summary.available) {
      if (!summary.event.entryDeadline && !summary.event.entryClosedAt) return jsonError("Set an entry closing time before requesting commission.", 409);
      if (summary.availableAt && Date.now() < new Date(summary.availableAt).getTime()) return jsonError("Commission claims open after guest-list entry closes.", 409);
      if (summary.pendingApplications > 0) return jsonError("Review every application before requesting commission.", 409);
      return jsonError("There is no eligible commission balance for this event.", 409);
    }

    const profile = await context.admin.from("profiles").select("full_name").eq("id", context.user.id).maybeSingle();
    const organizerName = String(profile.data?.full_name || context.user.user_metadata?.full_name || context.user.email.split("@")[0]).slice(0, 100);
    const existing = summary.claim;
    let claim;
    if (existing) {
      if (!(["rejected", "failed", "cancelled"].includes(existing.status))) {
        return Response.json({ claim: existing, message: "A claim already exists for this event. Refresh to check its status." }, { status: 409 });
      }
      const updated = await context.admin.from("organizer_commission_claims")
        .update({ amount_paise: summary.amountPaise, status: "pending_manual_payment", payout_method: payout.method,
          payout_details_ciphertext: encryptedDetails, organizer_email: context.user.email, notification_status: "pending",
          manual_payment_reference: null, paid_at: null, reviewed_at: null, updated_at: new Date().toISOString() })
        .eq("id", existing.id).eq("status", existing.status)
        .select("id, amount_paise, status, payout_url, manual_payment_reference, paid_at, created_at").maybeSingle();
      if (updated.error) throw new Error(`Could not submit the commission claim: ${updated.error.message}`);
      if (!updated.data) return jsonError("This claim changed while you were submitting. Refresh and check its status.", 409);
      claim = updated.data;
    } else {
      const inserted = await context.admin.from("organizer_commission_claims")
        .insert({ event_id: eventId, organizer_id: context.user.id, amount_paise: summary.amountPaise,
          status: "pending_manual_payment", payout_method: payout.method, payout_details_ciphertext: encryptedDetails,
          organizer_email: context.user.email, notification_status: "pending" })
        .select("id, amount_paise, status, payout_url, manual_payment_reference, paid_at, created_at").single();
      if (inserted.error) {
        if (inserted.error.code === "23505") return jsonError("A claim for this event already exists. Refresh to check its status.", 409);
        throw new Error(`Could not submit the commission claim: ${inserted.error.message}`);
      }
      claim = inserted.data;
    }

    const notificationSent = await notifyCommissionAdmins({ claimId: claim.id, eventTitle: summary.event.title,
      organizerName, amountPaise: summary.amountPaise });
    await context.admin.from("organizer_commission_claims").update({
      notification_status: notificationSent ? "sent" : "failed", updated_at: new Date().toISOString(),
    }).eq("id", claim.id).eq("status", "pending_manual_payment");

    return Response.json({ claim, notificationSent, message: notificationSent
      ? "Commission request submitted. Guestora will review it and pay manually."
      : "Commission request was saved, but the email alert could not be sent. Please contact Guestora support." }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not submit the commission claim.", 500);
  }
}
