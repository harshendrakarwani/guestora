"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import SocialAuthButtons from "@/components/social-auth-buttons";
import { createClient } from "@/lib/supabase-browser";

const ADMIN_PANEL = "/organizer/commission/admin";

export default function AdminSignIn() {
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  async function verifyAdmin(token: string) {
    const response = await fetch("/api/organizer/commission/admin?access=1", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({})) as { error?: string; authorized?: boolean };
    if (!response.ok || result.authorized !== true) {
      if (response.status === 403) throw new Error("That account is not authorized for Guestora admin. Use the email configured for admin access.");
      throw new Error(result.error || "Admin sign-in could not be verified. Please try again.");
    }
    window.location.replace(ADMIN_PANEL);
  }

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (data.session?.access_token) {
        try { await verifyAdmin(data.session.access_token); }
        catch (caught) { if (active) setError(caught instanceof Error ? caught.message : "Admin access could not be verified."); }
      }
      if (active) setChecking(false);
    }).catch(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [supabase]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) throw signInError;
      if (!data.session?.access_token) throw new Error("Guestora did not create a sign-in session. Please try again.");
      await verifyAdmin(data.session.access_token);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="min-h-screen bg-[#080a10] px-4 py-12 text-white sm:py-20">
    <section className="mx-auto w-full max-w-lg rounded-3xl border border-slate-800 bg-[#11141c] p-7 shadow-2xl sm:p-10">
      <Link href="/" aria-label="Guestora home" className="text-2xl font-black tracking-tight">Guestora<span className="text-amber-400">.</span></Link>
      <p className="mt-10 text-xs font-black uppercase tracking-[0.28em] text-amber-400">Private access</p>
      <h1 className="mt-3 text-3xl font-black">Admin sign in</h1>
      <p className="mt-3 leading-7 text-slate-300">Use your Guestora account. Only the single admin email configured for this site can open the commission and activity panel.</p>
      {checking ? <div className="mt-7 rounded-xl border border-slate-800 bg-[#0b0e15] p-4 text-sm text-slate-300">Checking your existing sign-in…</div> : <>
        <SocialAuthButtons next={ADMIN_PANEL} audience="organizer" />
        <div className="mt-6 flex items-center gap-3 text-xs uppercase tracking-widest text-slate-500"><span className="h-px flex-1 bg-slate-800" />or use email<span className="h-px flex-1 bg-slate-800" /></div>
        <form onSubmit={submit} className="mt-6 space-y-5">
          <label className="block text-sm font-semibold">Admin email<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Your authorized Guestora email" className="mt-2 w-full rounded-xl border border-slate-700 bg-[#080b12] px-4 py-3 outline-none focus:border-amber-400" /></label>
          <label className="block text-sm font-semibold">Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your Guestora password" className="mt-2 w-full rounded-xl border border-slate-700 bg-[#080b12] px-4 py-3 outline-none focus:border-amber-400" /></label>
          {error && <p role="alert" className="rounded-xl border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}
          <button type="submit" disabled={loading} className="w-full rounded-xl bg-amber-400 px-5 py-4 font-bold text-black transition hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60">{loading ? "Verifying admin access…" : "Sign in to admin panel"}</button>
        </form>
      </>}
      <p className="mt-7 text-center text-sm text-slate-400"><Link href="/organizer/login" className="font-semibold text-slate-300 underline underline-offset-4 hover:text-white">Back to organizer sign in</Link></p>
    </section>
  </main>;
}
