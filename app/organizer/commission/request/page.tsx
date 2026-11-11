"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import SiteHeader from "@/components/site-header";
import { createClient } from "@/lib/supabase-browser";

type Summary = { event: { id: string; title: string }; amountPaise: number; pendingApplications: number; available: boolean; claim: { id: string; status: string } | null };
type Method = "upi" | "bank";

function CommissionRequestContent() {
  const eventId = useSearchParams().get("eventId") || "";
  const supabase = useMemo(() => createClient(), []);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [method, setMethod] = useState<Method>("upi");
  const [upiId, setUpiId] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [bankName, setBankName] = useState("");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadSummary = useCallback(async () => {
    if (!eventId) { setErrorMessage("Choose an event from your organizer dashboard first."); setLoading(false); return; }
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error("Please sign in again.");
      const response = await fetch(`/api/organizer/commission?eventId=${encodeURIComponent(eventId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
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
  async function submitClaim(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!summary || submitting || !consent) return;
    setSubmitting(true); setErrorMessage(""); setSuccessMessage("");
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error("Please sign in again.");
      const body = method === "upi" ? { eventId, payoutMethod: method, upiId } : { eventId, payoutMethod: method, accountHolder, accountNumber, ifsc, bankName };
      const response = await fetch("/api/organizer/commission", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; message?: string; notificationSent?: boolean };
      if (!response.ok) throw new Error(result.error || "Could not submit the commission request.");
      setSuccessMessage(result.message || "Commission request submitted.");
      setSummary((current) => current ? { ...current, claim: { id: "", status: "pending_manual_payment" } } : current);
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : "Could not submit the commission request."); }
    finally { setSubmitting(false); }
  }

  return <main className="min-h-screen bg-[#080a10] text-white">
    <SiteHeader area="organizer" current="dashboard" />
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link href={`/organizer/commission?eventId=${encodeURIComponent(eventId)}`} className="text-sm font-semibold text-amber-300 hover:text-amber-200">← Back to event commission</Link>
      <p className="mt-8 text-xs font-black uppercase tracking-[0.28em] text-amber-400">Organizer earnings</p>
      <h1 className="mt-2 text-3xl font-black sm:text-4xl">Request commission payout</h1>
      {loading && <section className="mt-7 rounded-2xl border border-slate-800 bg-[#11141c] p-6 text-slate-300">Loading event commission…</section>}
      {errorMessage && <div role="alert" className="mt-6 rounded-xl border border-rose-700 bg-rose-950/40 p-4 text-rose-200">{errorMessage}</div>}
      {successMessage && <div role="status" className="mt-6 rounded-xl border border-emerald-700 bg-emerald-950/40 p-4 text-emerald-200">{successMessage}<Link className="ml-2 underline" href={`/organizer/commission?eventId=${encodeURIComponent(eventId)}`}>View claim status</Link></div>}
      {summary && !successMessage && <>
        <section className="mt-6 rounded-2xl border border-slate-800 bg-[#11141c] p-5 sm:p-7">
          <p className="text-sm text-slate-400">Event</p><h2 className="mt-1 text-xl font-bold">{summary.event.title}</h2>
          <p className="mt-4 text-sm text-slate-400">Commission requested</p><p className="text-3xl font-black text-emerald-300">{currency(summary.amountPaise)}</p>
        </section>
        {!summary.available ? <section className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-amber-100">
          {summary.pendingApplications > 0 ? `Review all ${summary.pendingApplications} pending application${summary.pendingApplications === 1 ? "" : "s"} before requesting commission.` : "Commission is not available to claim yet. Entry must be closed and the event must have eligible paid applications."}
        </section> : summary.claim && !["rejected", "failed", "cancelled"].includes(summary.claim.status) ? <section className="mt-5 rounded-2xl border border-sky-700/60 bg-sky-950/30 p-5">A claim already exists for this event. <Link className="underline" href={`/organizer/commission?eventId=${encodeURIComponent(eventId)}`}>Check its status</Link>.</section> : <form onSubmit={(event) => void submitClaim(event)} className="mt-5 space-y-5 rounded-2xl border border-slate-800 bg-[#11141c] p-5 sm:p-7">
          <fieldset><legend className="text-sm font-semibold text-slate-200">Choose where you want the manual transfer</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 ${method === "upi" ? "border-amber-400 bg-amber-400/10" : "border-slate-700"}`}><input type="radio" name="payoutMethod" value="upi" checked={method === "upi"} onChange={() => setMethod("upi")} /> UPI ID</label>
              <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 ${method === "bank" ? "border-amber-400 bg-amber-400/10" : "border-slate-700"}`}><input type="radio" name="payoutMethod" value="bank" checked={method === "bank"} onChange={() => setMethod("bank")} /> Bank account</label>
            </div>
          </fieldset>
          {method === "upi" ? <label className="block text-sm font-semibold">UPI ID<input required autoComplete="off" maxLength={256} value={upiId} onChange={(event) => setUpiId(event.target.value)} placeholder="name@bank" className="mt-2 block w-full rounded-xl border border-slate-700 bg-[#0b0e15] px-4 py-3 text-white outline-none focus:border-amber-400" /></label> : <div className="space-y-4">
            <label className="block text-sm font-semibold">Account holder name<input required autoComplete="name" maxLength={100} value={accountHolder} onChange={(event) => setAccountHolder(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-700 bg-[#0b0e15] px-4 py-3 text-white outline-none focus:border-amber-400" /></label>
            <label className="block text-sm font-semibold">Account number<input required inputMode="numeric" autoComplete="off" maxLength={20} value={accountNumber} onChange={(event) => setAccountNumber(event.target.value.replace(/\D/g, ""))} className="mt-2 block w-full rounded-xl border border-slate-700 bg-[#0b0e15] px-4 py-3 text-white outline-none focus:border-amber-400" /></label>
            <label className="block text-sm font-semibold">IFSC code<input required autoComplete="off" maxLength={11} value={ifsc} onChange={(event) => setIfsc(event.target.value.toUpperCase())} placeholder="ABCD0123456" className="mt-2 block w-full rounded-xl border border-slate-700 bg-[#0b0e15] px-4 py-3 uppercase text-white outline-none focus:border-amber-400" /></label>
            <label className="block text-sm font-semibold">Bank name <span className="font-normal text-slate-400">(optional)</span><input autoComplete="organization" maxLength={100} value={bankName} onChange={(event) => setBankName(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-700 bg-[#0b0e15] px-4 py-3 text-white outline-none focus:border-amber-400" /></label>
          </div>}
          <label className="flex items-start gap-3 text-sm leading-6 text-slate-300"><input type="checkbox" required checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1" />I confirm these payout details are correct and authorize Guestora to use them only to process this commission claim.</label>
          <p className="rounded-xl border border-slate-700 bg-[#0b0e15] p-4 text-xs leading-5 text-slate-400">Your payout details are encrypted before storage and are visible only to authorized Guestora admins. The email alert contains a secure review link, not your bank details. Guestora will make the transfer manually; this form does not initiate an automatic payment.</p>
          <button type="submit" disabled={submitting || !consent} className="w-full rounded-xl bg-amber-400 px-5 py-3 font-bold text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50">{submitting ? "Submitting claim…" : "Submit commission claim"}</button>
        </form>}
      </>}
    </div>
  </main>;
}

export default function OrganizerCommissionRequestPage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#080a10] px-4 py-10 text-white">Loading payout request…</main>}><CommissionRequestContent /></Suspense>;
}
