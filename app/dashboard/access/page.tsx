"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import SiteHeader from "@/components/site-header";

export default function GuestDashboardAccessPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function sendAccessLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSent(false);
    try {
      const response = await fetch("/api/guest/dashboard/access-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not send an email link. Please try again.");
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send an email link. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
    <SiteHeader current="dashboard" />
    <main className="flex min-h-screen items-center justify-center bg-[#080b12] px-5 py-12 text-white">
      <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-[#11151e] p-7 shadow-2xl sm:p-9">
        <p className="mt-8 text-xs font-extrabold tracking-[0.25em] text-amber-400">GUEST DASHBOARD</p>
        <h1 className="mt-3 text-3xl font-black">Get a dashboard link</h1>
        <p className="mt-3 leading-7 text-slate-400">Enter the email address used when applying as a guest. We’ll send a reusable dashboard link to that inbox. It stays active until you request a new one.</p>

        <form onSubmit={(event) => void sendAccessLink(event)} className="mt-7 space-y-5">
          <label className="block text-sm font-semibold">
            Email address
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-[#080b12] px-4 py-3 outline-none focus:border-amber-400"
            />
          </label>
          {error && <p role="alert" className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}
          {sent && <p role="status" className="rounded-xl border border-emerald-900 bg-emerald-950/30 p-3 text-sm text-emerald-300">If guest applications are linked to that email, a secure dashboard link is on its way. It does not expire; requesting a new link disables this one.</p>}
          <button type="submit" disabled={loading} className="w-full rounded-xl bg-amber-400 px-5 py-4 font-bold text-black hover:bg-amber-300 disabled:opacity-60">
            {loading ? "Sending email..." : "Email me a dashboard link"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-400">Have a Guestora account? <Link href="/login" className="font-semibold text-amber-400 underline underline-offset-4">Guest sign in</Link></p>
      </section>
    </main>
    </>
  );
}
