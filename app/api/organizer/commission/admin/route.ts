import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";
import { decryptCommissionPayoutDetails } from "@/lib/commission-payout-crypto";

const errorJson = (message: string, status: number) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

async function getAdminContext(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { error: errorJson("Sign in with the Guestora admin account.", 401) } as const;
  const allowed = (process.env.COMMISSION_ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (allowed.length !== 1) return { error: errorJson("Set exactly one commission admin email in the server configuration.", 503) } as const;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { error: errorJson("Supabase is not configured on the server.", 500) } as const;
  const auth = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return { error: errorJson("Please sign in again.", 401) } as const;
  if (!data.user.email || !allowed.includes(data.user.email.trim().toLowerCase())) {
    return { error: errorJson("You are not authorized to review commission claims.", 403) } as const;
  }
  try { return { admin: createAdminClient() } as const; }
  catch { return { error: errorJson("Admin database access is not configured.", 503) } as const; }
}

export async function GET(request: Request) {
  const context = await getAdminContext(request);
  if ("error" in context) return context.error;
  const url = new URL(request.url);
  if (url.searchParams.get("access") === "1") {
    return Response.json({ authorized: true }, { headers: { "Cache-Control": "no-store" } });
  }
  if (url.searchParams.get("overview") === "1") {
    try {
      const [eventsResult, profilesResult, applicationsResult, sharesResult, claimsResult] = await Promise.all([
        context.admin.from("events").select("id, organizer_id, title, venue_name, city, state, status, created_at, entry_deadline, entry_closed_at").order("created_at", { ascending: false }),
        context.admin.from("profiles").select("id, full_name"),
        context.admin.from("guest_applications").select("id, event_id, status, payment_status, application_fee_paise, checked_in_at, created_at").order("created_at", { ascending: false }),
        context.admin.from("organizer_revenue_shares").select("application_id, organizer_id, gross_paise, share_paise, payout_status"),
        context.admin.from("organizer_commission_claims").select("id, event_id, organizer_id, organizer_email, amount_paise, status, manual_payment_reference, paid_at, created_at, reviewed_at").order("created_at", { ascending: false }),
      ]);
      const coreQueryError = eventsResult.error || applicationsResult.error;
      if (coreQueryError) {
        const source = eventsResult.error ? "events" : "guest applications";
        console.error(`Commission admin overview: ${source} query failed`, coreQueryError);
        return errorJson(`Could not load ${source}. Refresh and try again.`, 500);
      }
      // These are supporting details. A missing profile or commission column
      // should not prevent the admin from seeing event and applicant activity.
      if (profilesResult.error) console.error("Commission admin overview: profiles query failed", profilesResult.error);
      if (sharesResult.error) console.error("Commission admin overview: revenue shares query failed", sharesResult.error);
      if (claimsResult.error) console.error("Commission admin overview: claims summary query failed", claimsResult.error);
      const eventRows = eventsResult.data ?? [];
      const userIds = [...new Set(eventRows.map((event) => event.organizer_id).filter(Boolean))];
      const userResults = await Promise.all(userIds.map((id) => context.admin.auth.admin.getUserById(id)));
      const organizerEmails = new Map(userIds.map((id, index) => [id, userResults[index].data.user?.email ?? ""]));
      const names = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.full_name ?? ""]));
      const appsById = new Map((applicationsResult.data ?? []).map((application) => [application.id, application]));
      const appsByEvent = new Map<string, typeof applicationsResult.data>();
      for (const application of applicationsResult.data ?? []) {
        const rows = appsByEvent.get(application.event_id) ?? [];
        rows.push(application);
        appsByEvent.set(application.event_id, rows);
      }
      const sharesByEvent = new Map<string, { earned: number; paid: number; outstanding: number }>();
      for (const share of sharesResult.data ?? []) {
        const application = appsById.get(share.application_id);
        if (!application || application.payment_status !== "paid" || application.status === "rejected" || share.payout_status === "refunded") continue;
        const totals = sharesByEvent.get(application.event_id) ?? { earned: 0, paid: 0, outstanding: 0 };
        const amount = Number(share.share_paise || 0);
        totals.earned += amount;
        if (share.payout_status === "transferred") totals.paid += amount;
        else if (["pending_route_setup", "ready"].includes(share.payout_status)) totals.outstanding += amount;
        sharesByEvent.set(application.event_id, totals);
      }
      const claimsByEvent = new Map<string, typeof claimsResult.data>();
      for (const claim of claimsResult.data ?? []) {
        const rows = claimsByEvent.get(claim.event_id) ?? [];
        rows.push(claim);
        claimsByEvent.set(claim.event_id, rows);
      }
      const events = eventRows.map((event) => {
        const applications = appsByEvent.get(event.id) ?? [];
        const paid = applications.filter((application) => application.payment_status === "paid");
        const totals = sharesByEvent.get(event.id) ?? { earned: 0, paid: 0, outstanding: 0 };
        const claims = claimsByEvent.get(event.id) ?? [];
        const latestClaim = claims[0];
        return {
          id: event.id, title: event.title, venueName: event.venue_name, city: event.city, state: event.state,
          status: event.status, createdAt: event.created_at, entryDeadline: event.entry_deadline, entryClosedAt: event.entry_closed_at,
          organizerId: event.organizer_id, organizerName: names.get(event.organizer_id) || "Organizer",
          organizerEmail: organizerEmails.get(event.organizer_id) || latestClaim?.organizer_email || "",
          applicants: applications.length, paidApplications: paid.length,
          approvedApplications: applications.filter((application) => application.status === "approved").length,
          rejectedApplications: applications.filter((application) => application.status === "rejected").length,
          pendingApplications: applications.filter((application) => application.status === "pending").length,
          checkedIn: applications.filter((application) => Boolean(application.checked_in_at)).length,
          grossPaidPaise: paid.reduce((sum, application) => sum + Number(application.application_fee_paise || 0), 0),
          earnedCommissionPaise: totals.earned, paidCommissionPaise: totals.paid, outstandingCommissionPaise: totals.outstanding,
          latestClaim: latestClaim ? { id: latestClaim.id, status: latestClaim.status, amountPaise: latestClaim.amount_paise,
            paymentReference: latestClaim.manual_payment_reference, paidAt: latestClaim.paid_at,
            createdAt: latestClaim.created_at, reviewedAt: latestClaim.reviewed_at } : null,
        };
      });
      const totals = events.reduce((sum, event) => ({
        events: sum.events + 1, applicants: sum.applicants + event.applicants, grossPaidPaise: sum.grossPaidPaise + event.grossPaidPaise,
        earnedCommissionPaise: sum.earnedCommissionPaise + event.earnedCommissionPaise,
        paidCommissionPaise: sum.paidCommissionPaise + event.paidCommissionPaise,
        outstandingCommissionPaise: sum.outstandingCommissionPaise + event.outstandingCommissionPaise,
      }), { events: 0, applicants: 0, grossPaidPaise: 0, earnedCommissionPaise: 0, paidCommissionPaise: 0, outstandingCommissionPaise: 0 });
      return Response.json({ events, totals }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return errorJson("Could not assemble the admin overview.", 500);
    }
  }
  const claimId = url.searchParams.get("claimId")?.trim();
  let query = context.admin.from("organizer_commission_claims")
    .select("id, event_id, organizer_id, organizer_email, amount_paise, status, payout_method, payout_details_ciphertext, manual_payment_reference, paid_at, created_at, notification_status")
    .order("created_at", { ascending: false }).limit(100);
  if (claimId) query = query.eq("id", claimId);
  else query = query.in("status", ["pending_manual_payment", "manual_processing"]);
  const { data: claims, error } = await query;
  if (error) return errorJson("Could not load commission claims.", 500);
  const eventIds = [...new Set((claims ?? []).map((claim) => claim.event_id))];
  const { data: events, error: eventError } = eventIds.length
    ? await context.admin.from("events").select("id, title").in("id", eventIds)
    : { data: [], error: null };
  if (eventError) return errorJson("Could not load event names for the commission queue.", 500);
  const eventTitles = new Map((events ?? []).map((event) => [event.id, event.title]));
  try {
    return Response.json({ claims: (claims ?? []).map((claim) => ({
      id: claim.id,
      eventId: claim.event_id,
      eventTitle: eventTitles.get(claim.event_id) || "Event",
      organizerId: claim.organizer_id,
      organizerEmail: claim.organizer_email,
      amountPaise: claim.amount_paise,
      status: claim.status,
      payoutMethod: claim.payout_method,
      payoutDetails: claim.payout_details_ciphertext
        ? decryptCommissionPayoutDetails<Record<string, string>>(claim.payout_details_ciphertext)
        : null,
      paymentReference: claim.manual_payment_reference,
      paidAt: claim.paid_at,
      createdAt: claim.created_at,
      notificationStatus: claim.notification_status,
    })) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return errorJson("Could not decrypt payout details. Check the commission encryption key before viewing this claim.", 503);
  }
}

export async function PATCH(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return errorJson("Request could not be completed.", 403);
  const context = await getAdminContext(request);
  if ("error" in context) return context.error;
  const body = await request.json().catch(() => null) as { claimId?: unknown; action?: unknown; paymentReference?: unknown; eventId?: unknown; paidAt?: unknown } | null;
  if (body?.action === "record_existing_payment") {
    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    const reference = typeof body.paymentReference === "string" ? body.paymentReference.trim().slice(0, 100) : "";
    const paidAt = typeof body.paidAt === "string" ? new Date(body.paidAt) : new Date();
    if (!eventId || !reference) return errorJson("Choose an event and enter the bank or UPI transfer reference.", 400);
    if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 60_000) return errorJson("Enter a valid payment date and time.", 400);
    const { data, error } = await context.admin.rpc("record_manual_organizer_commission_payment", {
      p_event_id: eventId, p_payment_reference: reference, p_paid_at: paidAt.toISOString(),
    });
    if (error) {
      const expected = ["Close guest-list entry", "Review all event applications", "Enter the bank or UPI transaction reference", "Enter a valid payment date"].some((message) => error.message.includes(message));
      return errorJson(expected ? error.message : "Could not record this payment. Refresh and check the event ledger.", expected ? 409 : 500);
    }
    if (!data) return errorJson("No unpaid commission was found for this event, or it has already been recorded as paid.", 409);
    return Response.json({ success: true, claimId: data }, { headers: { "Cache-Control": "no-store" } });
  }
  const claimId = typeof body?.claimId === "string" ? body.claimId.trim() : "";
  const action = typeof body?.action === "string" ? body.action : "";
  if (!claimId || !["manual_processing", "paid", "rejected"].includes(action)) return errorJson("Choose a valid claim action.", 400);
  const reference = typeof body?.paymentReference === "string" ? body.paymentReference.trim().slice(0, 100) : null;
  if (action === "paid" && !reference) return errorJson("Enter the UPI or bank transfer reference before marking this claim paid.", 400);
  const { data, error } = await context.admin.rpc("update_manual_organizer_commission_claim", {
    p_claim_id: claimId,
    p_next_status: action,
    p_payment_reference: reference,
  });
  if (error) return errorJson("Could not update this commission claim.", 500);
  if (data !== true) return errorJson("This claim changed or is no longer eligible for that action. Refresh the queue.", 409);
  return Response.json({ success: true, status: action }, { headers: { "Cache-Control": "no-store" } });
}
