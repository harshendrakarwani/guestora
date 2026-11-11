"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import SiteHeader from "@/components/site-header";
import { createClient } from "@/lib/supabase-browser";

type Claim = {
  id: string; eventId: string; eventTitle: string; organizerEmail: string; amountPaise: number; status: string;
  payoutMethod: "upi" | "bank" | null; payoutDetails: Record<string, string> | null; paymentReference: string | null;
  createdAt: string; notificationStatus: string;
};
type AdminEvent = {
  id: string; title: string; venueName: string | null; city: string | null; state: string | null; status: string;
  createdAt: string; entryDeadline: string | null; entryClosedAt: string | null; organizerId: string;
  organizerName: string; organizerEmail: string; applicants: number; paidApplications: number; approvedApplications: number;
  rejectedApplications: number; pendingApplications: number; checkedIn: number; grossPaidPaise: number;
  earnedCommissionPaise: number; paidCommissionPaise: number; outstandingCommissionPaise: number;
  latestClaim: { id: string; status: string; amountPaise: number; paymentReference: string | null; paidAt: string | null; createdAt: string; reviewedAt: string | null } | null;
};
type AdminTotals = { events: number; applicants: number; grossPaidPaise: number; earnedCommissionPaise: number; paidCommissionPaise: number; outstandingCommissionPaise: number };

function CommissionAdminContent() {
  const claimId = useSearchParams().get("claimId") || "";
  const supabase = useMemo(() => createClient(), []);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [totals, setTotals] = useState<AdminTotals | null>(null);
  const [reference, setReference] = useState<Record<string, string>>({});
  const [paidAt, setPaidAt] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");

  const loadClaims = useCallback(async () => {
    setLoading(true); setErrorMessage("");
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) {
        window.location.replace("/admin/sign-in");
        return;
      }
      const query = claimId ? `?claimId=${encodeURIComponent(claimId)}` : "";
      const [response, overviewResponse] = await Promise.all([
        fetch(`/api/organizer/commission/admin${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
        fetch("/api/organizer/commission/admin?overview=1", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
      ]);
      const [result, overview] = await Promise.all([
        response.json().catch(() => ({})) as Promise<{ error?: string; claims?: Claim[] }>,
        overviewResponse.json().catch(() => ({})) as Promise<{ error?: string; events?: AdminEvent[]; totals?: AdminTotals }>,
      ]);
      if (response.status === 401 || overviewResponse.status === 401) {
        window.location.replace("/admin/sign-in");
        return;
      }
      if (!response.ok) throw new Error(result.error || "Could not load commission claims.");
      setAuthorized(true);
      setClaims(result.claims || []);
      if (!overviewResponse.ok) throw new Error(overview.error || "Could not load event tracking.");
      setEvents(overview.events || []);
      setTotals(overview.totals || null);
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : "Could not load commission claims."); }
    finally { setLoading(false); }
  }, [claimId, supabase]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadClaims(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadClaims]);

  async function updateClaim(claim: Claim, action: "manual_processing" | "paid" | "rejected") {
    if (busyId) return;
    if (action === "paid" && !reference[claim.id]?.trim()) { setErrorMessage("Enter the bank or UPI transfer reference first."); return; }
    setBusyId(claim.id); setErrorMessage(""); setNotice("");
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error("Sign in with your Guestora admin account.");
      const response = await fetch("/api/organizer/commission/admin", {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ claimId: claim.id, action, paymentReference: reference[claim.id] || "" }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not update claim status.");
      setNotice(action === "paid" ? "Claim marked paid and event commission ledger updated." : action === "rejected" ? "Claim rejected. The organizer can submit updated payout details." : "Claim marked as processing.");
      await loadClaims();
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : "Could not update claim status."); }
    finally { setBusyId(""); }
  }

  async function recordExistingPayment(event: AdminEvent) {
    if (busyId) return;
    const value = reference[`event:${event.id}`]?.trim();
    if (!value) { setErrorMessage("Enter the bank or UPI transfer reference first."); return; }
    if (!window.confirm(`Record ${currency(event.outstandingCommissionPaise)} as already paid for ${event.title}? This will close the unpaid commission ledger for this event.`)) return;
    setBusyId(event.id); setErrorMessage(""); setNotice("");
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error("Sign in with your Guestora admin account.");
      const response = await fetch("/api/organizer/commission/admin", {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "record_existing_payment", eventId: event.id, paymentReference: value,
          paidAt: paidAt[event.id] ? new Date(paidAt[event.id]).toISOString() : new Date().toISOString() }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not record the payment.");
      setNotice(`Existing payment recorded for ${event.title}. The organizer’s commission is now marked paid.`);
      await loadClaims();
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : "Could not record the payment."); }
    finally { setBusyId(""); }
  }

  const currency = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (!loading && !authorized) return <main className="min-h-screen bg-[#080a10] px-4 py-20 text-white"><section className="mx-auto max-w-xl rounded-2xl border border-rose-900 bg-[#11141c] p-8 text-center"><p className="text-xs font-black uppercase tracking-[0.28em] text-amber-400">Guestora admin</p><h1 className="mt-3 text-3xl font-black">Admin access required</h1><p className="mt-3 text-slate-300">Sign in through the dedicated admin sign-in page using the one email authorized for Guestora admin access.</p><Link href="/admin/sign-in" className="mt-6 inline-flex rounded-xl bg-amber-400 px-5 py-3 font-bold text-black hover:bg-amber-300">Go to admin sign in</Link>{errorMessage && <p role="alert" className="mt-4 text-sm text-rose-200">{errorMessage}</p>}</section></main>;

  return <main className="min-h-screen bg-[#080a10] text-white">
    <SiteHeader area="organizer" current="dashboard" />
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <Link href="/organizer" className="text-sm font-semibold text-amber-300 hover:text-amber-200">← Organizer dashboard</Link>
      <p className="mt-8 text-xs font-black uppercase tracking-[0.28em] text-amber-400">Guestora admin</p>
      <h1 className="mt-2 text-3xl font-black sm:text-4xl">Commission admin</h1>
      <p className="mt-3 max-w-3xl text-slate-300">Track Guestora activity and organizer commission by event. Record payments already made here so they leave the unpaid balance and appear in payment history.</p>
      {errorMessage && <div role="alert" className="mt-6 rounded-xl border border-rose-700 bg-rose-950/40 p-4 text-rose-200">{errorMessage}<button onClick={() => void loadClaims()} className="ml-3 underline">Retry</button></div>}
      {notice && <div role="status" className="mt-6 rounded-xl border border-emerald-700 bg-emerald-950/40 p-4 text-emerald-200">{notice}</div>}
      {loading && <section className="mt-6 rounded-2xl border border-slate-800 bg-[#11141c] p-6 text-slate-300">Loading commission claims…</section>}
      {!loading && totals && <>
        <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ["Events", String(totals.events)], ["Applicants", String(totals.applicants)], ["Guest fees collected", currency(totals.grossPaidPaise)],
            ["Organizer commission earned", currency(totals.earnedCommissionPaise)], ["Commission paid / outstanding", `${currency(totals.paidCommissionPaise)} / ${currency(totals.outstandingCommissionPaise)}`],
          ].map(([label, value]) => <article key={label} className="rounded-2xl border border-slate-800 bg-[#11141c] p-5"><p className="text-sm text-slate-400">{label}</p><p className="mt-2 text-2xl font-black text-white">{value}</p></article>)}
        </section>
        <section className="mt-9">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-black">Event ledger</h2><p className="mt-1 text-sm text-slate-400">Each event has its own applicant, collection, and commission totals.</p></div><button onClick={() => void loadClaims()} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold hover:border-amber-400">Refresh</button></div>
          {!events.length ? <div className="mt-4 rounded-2xl border border-slate-800 bg-[#11141c] p-6 text-slate-300">No events found.</div> : <div className="mt-4 grid gap-5 lg:grid-cols-2">{events.map((event) => <article key={event.id} className="rounded-2xl border border-slate-800 bg-[#11141c] p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-bold">{event.title}</h3><p className="mt-1 text-sm text-slate-400">{[event.venueName, event.city, event.state].filter(Boolean).join(" · ") || "Location not set"}</p></div><span className="rounded-full border border-slate-700 px-3 py-1 text-xs capitalize text-slate-300">{event.status}</span></div>
            <div className="mt-4 rounded-xl bg-[#0b0e15] p-4"><p className="font-semibold">{event.organizerName}</p><p className="mt-1 break-all text-sm text-slate-400">{event.organizerEmail || event.organizerId}</p><p className="mt-2 text-xs text-slate-500">Created {new Date(event.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p></div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">{[
              ["Applicants", event.applicants], ["Paid", event.paidApplications], ["Approved", event.approvedApplications], ["Rejected", event.rejectedApplications], ["Pending review", event.pendingApplications], ["Checked in", event.checkedIn],
              ["Fees collected", currency(event.grossPaidPaise)], ["Commission earned", currency(event.earnedCommissionPaise)], ["Paid", currency(event.paidCommissionPaise)], ["Still unpaid", currency(event.outstandingCommissionPaise)],
            ].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-[#0b0e15] p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-bold text-white">{value}</p></div>)}</div>
            {event.latestClaim && <div className="mt-4 rounded-xl border border-slate-800 p-4 text-sm"><p className="font-semibold capitalize">Latest commission: {event.latestClaim.status.replaceAll("_", " ")}</p><p className="mt-1 text-slate-400">Requested {new Date(event.latestClaim.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}{event.latestClaim.paidAt ? ` · Paid ${new Date(event.latestClaim.paidAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : ""}</p>{event.latestClaim.paymentReference && <p className="mt-1 break-all text-slate-400">Reference: {event.latestClaim.paymentReference}</p>}</div>}
            {event.outstandingCommissionPaise > 0 && event.pendingApplications === 0 && (event.entryClosedAt || (event.entryDeadline && new Date(event.entryDeadline).getTime() <= Date.now())) && <div className="mt-4 border-t border-slate-800 pt-4"><p className="text-sm font-semibold text-amber-100">Already paid outside Guestora?</p><div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><label className="text-xs text-slate-400">Payment date and time<input type="datetime-local" value={paidAt[event.id] || ""} onChange={(e) => setPaidAt((current) => ({ ...current, [event.id]: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-700 bg-[#0b0e15] px-3 py-2 text-sm text-white" /></label><label className="text-xs text-slate-400">UTR / transaction reference<input value={reference[`event:${event.id}`] || ""} onChange={(e) => setReference((current) => ({ ...current, [`event:${event.id}`]: e.target.value }))} placeholder="Required" maxLength={100} className="mt-1 block w-full rounded-lg border border-slate-700 bg-[#0b0e15] px-3 py-2 text-sm text-white" /></label><button onClick={() => void recordExistingPayment(event)} disabled={busyId === event.id} className="self-end rounded-lg bg-emerald-300 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-50">{busyId === event.id ? "Saving…" : "Record paid"}</button></div></div>}
          </article>)}</div>}
        </section>
      </>}
      <section className="mt-10"><h2 className="text-2xl font-black">Claims waiting for review</h2><p className="mt-1 text-sm text-slate-400">Open payout details, send the transfer, and save its reference.</p></section>
      {!loading && !claims.length && !errorMessage && <section className="mt-6 rounded-2xl border border-slate-800 bg-[#11141c] p-6 text-slate-300">No commission claims are waiting for review.</section>}
      <div className="mt-6 space-y-5">{claims.map((claim) => {
        const pending = claim.status === "pending_manual_payment";
        const processing = claim.status === "manual_processing";
        const paid = claim.status === "paid";
        const details = claim.payoutDetails || {};
        const upiUri = claim.payoutMethod === "upi" && details.upiId
          ? `upi://pay?${new URLSearchParams({
            pa: details.upiId,
            pn: "Guestora",
            am: (claim.amountPaise / 100).toFixed(2),
            cu: "INR",
            tn: `Organizer commission ${claim.eventTitle}`.slice(0, 80),
            tr: claim.id.replace(/-/g, "").slice(0, 35),
          }).toString()}`
          : "";
        return <section key={claim.id} className="rounded-2xl border border-slate-800 bg-[#11141c] p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{claim.eventTitle}</h2><p className="mt-1 text-sm text-slate-400">{claim.organizerEmail} · {new Date(claim.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p></div><span className="rounded-full border border-slate-700 px-3 py-1 text-xs uppercase tracking-wide">{claim.status.replaceAll("_", " ")}</span></div>
          <p className="mt-5 text-sm text-slate-400">Commission to transfer</p><p className="text-3xl font-black text-emerald-300">{currency(claim.amountPaise)}</p>
          <div className="mt-5 rounded-xl border border-slate-700 bg-[#0b0e15] p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{claim.payoutMethod === "upi" ? "UPI destination" : "Bank destination"}</p>
            {claim.payoutMethod === "upi" ? <p className="mt-2 break-all text-lg font-semibold">{details.upiId || "Unavailable"}</p> : <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-slate-400">Account holder</dt><dd>{details.accountHolder || "Unavailable"}</dd></div><div><dt className="text-slate-400">Account number</dt><dd className="break-all">{details.accountNumber || "Unavailable"}</dd></div><div><dt className="text-slate-400">IFSC</dt><dd>{details.ifsc || "Unavailable"}</dd></div><div><dt className="text-slate-400">Bank</dt><dd>{details.bankName || "Not provided"}</dd></div></dl>}
          </div>
          {upiUri && !paid && <div className="mt-5 flex flex-wrap items-center gap-5 rounded-xl border border-slate-700 bg-[#0b0e15] p-4">
            <div className="rounded-lg bg-white p-2"><QRCodeSVG value={upiUri} size={144} level="M" /></div>
            <div className="max-w-md flex-1">
              <p className="font-semibold">Pay with UPI</p>
              <p className="mt-1 text-sm leading-6 text-slate-300">Scan this QR on your phone, or open the payment link on your phone. Your UPI app will show the recipient and amount for you to review and approve.</p>
              <a href={upiUri} className="mt-3 inline-flex rounded-xl bg-amber-400 px-4 py-2 font-bold text-black hover:bg-amber-300">Open UPI app</a>
              <p className="mt-2 text-xs leading-5 text-slate-500">This is a payment handoff, not an automatic payout. Confirm the UPI app shows the correct destination and ₹ amount before authorizing. Then enter the transfer reference below.</p>
            </div>
          </div>}
          {paid ? <p className="mt-4 text-sm text-emerald-200">Paid reference: {claim.paymentReference || "Not recorded"}</p> : <>
            <label className="mt-5 block text-sm font-semibold">Transfer UTR / transaction reference<input maxLength={100} value={reference[claim.id] || ""} onChange={(event) => setReference((current) => ({ ...current, [claim.id]: event.target.value }))} placeholder="Required after you send the payment" className="mt-2 block w-full rounded-xl border border-slate-700 bg-[#0b0e15] px-4 py-3 text-white outline-none focus:border-amber-400" /></label>
            <div className="mt-4 flex flex-wrap gap-3">
              {(pending || processing) && <button onClick={() => void updateClaim(claim, "paid")} disabled={busyId === claim.id} className="rounded-xl bg-amber-400 px-5 py-3 font-bold text-black disabled:opacity-50">{busyId === claim.id ? "Saving…" : "Mark paid"}</button>}
              {pending && <><button onClick={() => void updateClaim(claim, "manual_processing")} disabled={busyId === claim.id} className="rounded-xl border border-slate-600 px-5 py-3 font-semibold hover:bg-slate-800 disabled:opacity-50">Mark processing</button><button onClick={() => { if (window.confirm("Reject this claim? No transfer should have been sent. The organizer can submit corrected payout details.")) void updateClaim(claim, "rejected"); }} disabled={busyId === claim.id} className="rounded-xl border border-rose-700 px-5 py-3 font-semibold text-rose-200 hover:bg-rose-950/40 disabled:opacity-50">Reject claim</button></>}
            </div>
          </>}
        </section>;
      })}</div>
    </div>
  </main>;
}

export default function CommissionAdminPage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#080a10] px-4 py-10 text-white">Loading commission admin…</main>}><CommissionAdminContent /></Suspense>;
}
