"use client";

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import SiteHeader from "@/components/site-header";
import { createClient } from "@/lib/supabase-browser";

type Claim = { id: string; amount_paise: number; status: string; payout_url?: string | null; manual_payment_reference?: string | null; paid_at?: string | null; created_at: string };
type Summary = {
  event: { id: string; title: string; entryDeadline: string | null; entryClosedAt?: string | null };
  amountPaise: number; eligibleApplications: number; pendingApplications: number;
  availableAt: string | null; available: boolean; entryClosePending: boolean; claim: Claim | null;
};

function OrganizerCommissionContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get("eventId") || "";
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const supabase = useMemo(() => createClient(), []);
  const loadSummary = useCallback(async () => {
    if (!eventId) { setErrorMessage("Choose an event from your organizer dashboard first."); setLoading(false); return; }
    setLoading(true); setErrorMessage("");
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error("Please sign in again.");
      const response = await fetch(`/api/organizer/commission?eventId=${encodeURIComponent(eventId)}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15000),
      });
      const result = await response.json().catch(() => ({})) as Summary & { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not load commission.");
      setSummary(result);
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : "Could not load commission."); }
    finally { setLoading(false); }
  }, [eventId, supabase]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadSummary(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadSummary]);

  const currency = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const terminalClaim = summary?.claim && ["rejected", "failed", "cancelled"].includes(summary.claim.status);

  return <main className="min-h-screen bg-[#080a10] text-white">
    <SiteHeader area="organizer" current="dashboard" />
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link href="/organizer" className="text-sm font-semibold text-amber-300 hover:text-amber-200">← Organizer dashboard</Link>
      <p className="mt-8 text-xs font-black uppercase tracking-[0.28em] text-amber-400">Organizer earnings</p>
      <h1 className="mt-2 text-3xl font-black sm:text-4xl">Claim commission</h1>
      <p className="mt-3 max-w-2xl text-slate-300">Guestora commission is 40% of eligible paid application fees. On a ₹30 application, that is ₹12.</p>
      {errorMessage && <div role="alert" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-700 bg-rose-950/40 p-4 text-rose-200"><span>{errorMessage}</span><button type="button" onClick={() => void loadSummary()} disabled={loading} className="rounded-lg border border-rose-700 px-4 py-2 font-semibold hover:bg-rose-900/40 disabled:opacity-50">Retry</button></div>}
      <section className="mt-7 rounded-2xl border border-slate-800 bg-[#11141c] p-5 sm:p-7">
        {loading && !summary ? <p className="text-slate-300">Loading your event commission…</p> : summary ? <>
          <h2 className="text-xl font-bold">{summary.event.title}</h2>
          <div className="mt-5 rounded-xl bg-[#0b0e15] p-4">
            <p className="text-sm text-slate-400">Total event commission available to claim</p>
            <p className="mt-1 text-4xl font-black text-emerald-300">{currency(summary.amountPaise)}</p>
          </div>
          {summary.pendingApplications > 0 && <p className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">Review the remaining {summary.pendingApplications} pending application{summary.pendingApplications === 1 ? "" : "s"} before claiming.</p>}
          {!summary.available && summary.pendingApplications === 0 && summary.entryClosePending && summary.availableAt && <p className="mt-5 rounded-xl border border-slate-700 bg-[#0b0e15] p-4 text-sm text-slate-300">Claims open after guest-list entry closes: {new Date(summary.availableAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.</p>}
          {!summary.available && !summary.event.entryDeadline && !summary.event.entryClosedAt && <p className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">Set an entry closing time for this event to enable commission claims.</p>}

          {summary.claim?.payout_url ? <div className="mt-6 rounded-xl border border-emerald-700/60 bg-emerald-950/30 p-4">
            <p className="font-bold">Your existing payout link is ready</p><a href={summary.claim.payout_url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex rounded-xl bg-amber-400 px-5 py-3 font-bold text-black hover:bg-amber-300">Open payout link</a>
          </div> : summary.claim && !terminalClaim ? <div className="mt-6 rounded-xl border border-sky-700/60 bg-sky-950/30 p-4">
            <p className="font-bold">Commission request: {summary.claim.status.replaceAll("_", " ")}</p>
            {summary.claim.status === "pending_manual_payment" && <p className="mt-1 text-sm text-slate-300">Your request is in Guestora’s review queue. A notification was sent to the Guestora team when available.</p>}
            {summary.claim.status === "manual_processing" && <p className="mt-1 text-sm text-slate-300">Your payout is being processed manually.</p>}
            {summary.claim.status === "paid" && <p className="mt-1 text-sm text-slate-300">Paid {summary.claim.manual_payment_reference ? `with reference ${summary.claim.manual_payment_reference}` : ""}.</p>}
          </div> : summary.available && summary.amountPaise >= 100
            ? <Link href={`/organizer/commission/request?eventId=${encodeURIComponent(eventId)}`} className="mt-6 inline-flex rounded-xl bg-amber-400 px-5 py-3 font-bold text-black hover:bg-amber-300">{terminalClaim ? "Update payout details and resubmit" : "Claim commission"}</Link>
            : <button type="button" disabled className="mt-6 inline-flex cursor-not-allowed rounded-xl bg-amber-400 px-5 py-3 font-bold text-black opacity-50">{terminalClaim ? "Update payout details and resubmit" : "Claim commission"}</button>}
          <p className="mt-5 text-xs leading-5 text-slate-500">A claim becomes available after entry closes and all applications are reviewed. Choose UPI or bank transfer; the Guestora team reviews claims and makes payments manually. Payout details are stored encrypted and aren’t included in email notifications.</p>
        </> : null}
      </section>
    </div>
  </main>;
}

export default function OrganizerCommissionPage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#080a10] px-4 py-10 text-white">Loading commission…</main>}><OrganizerCommissionContent /></Suspense>;
}
