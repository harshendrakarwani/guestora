"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import SocialAuthButtons from "@/components/social-auth-buttons";
import SiteHeader from "@/components/site-header";
import { addAccountRolePatch, hasAccountRole } from "@/lib/account-roles";

type Audience = "guest" | "organizer";

export default function AccountSignIn({ audience, initialError = "" }: { audience: Audience; initialError?: string }) {
  const supabase = useMemo(() => createClient(), []);
  const isOrganizer = audience === "organizer";
  const destination = isOrganizer ? "/organizer" : "/dashboard";
  const signupHref = isOrganizer ? "/organizer/signup" : "/signup";
  const [returnTo, setReturnTo] = useState(destination);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;

    async function redirectIfSignedIn() {
      const requestedNext = new URLSearchParams(window.location.search).get("next");
      const eventPathIsSafe = requestedNext && /^\/events\/[a-zA-Z0-9-]+$/.test(requestedNext);
      const nextDestination = !isOrganizer && eventPathIsSafe ? requestedNext : destination;
      setReturnTo(nextDestination);
      const { data } = await supabase.auth.getSession();
      if (!active || !data.session) return;

      if (!hasAccountRole(data.session.user.user_metadata, audience)) {
        const { error: roleError } = await supabase.auth.updateUser({
          data: addAccountRolePatch(data.session.user.user_metadata, audience),
        });
        if (roleError) {
          setError(`Could not enable this workspace: ${roleError.message}`);
          return;
        }
        const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || !hasAccountRole(refreshed.session?.user.user_metadata, audience)) {
          setError(`Could not confirm access to this workspace${refreshError ? `: ${refreshError.message}` : ". Please sign in again."}`);
          return;
        }
      }
      // A document navigation makes the newly refreshed Supabase session and
      // workspace role available before the dashboard performs its role check.
      window.location.replace(nextDestination);
    }

    void redirectIfSignedIn();
    return () => {
      active = false;
    };
  }, [audience, destination, isOrganizer, supabase]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) throw signInError;
      if (!hasAccountRole(signInData.user.user_metadata, audience)) {
        const { error: roleError } = await supabase.auth.updateUser({
          data: addAccountRolePatch(signInData.user.user_metadata, audience),
        });
        if (roleError) throw roleError;

        const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) throw refreshError;
        if (!hasAccountRole(refreshed.session?.user.user_metadata, audience)) {
          throw new Error("Workspace access could not be confirmed. Please sign in again.");
        }
      }
      setMessage("Signed in. Opening your workspace...");
      // Avoid using a possibly cached client route before refreshed role
      // metadata has propagated to the dashboard.
      window.location.replace(isOrganizer ? "/organizer" : returnTo);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to sign in. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
    <SiteHeader area={isOrganizer ? "organizer" : "guest"} />
    <main className="flex min-h-screen items-center justify-center bg-[#080b12] px-5 py-10 text-white">
      <section className="w-full max-w-lg rounded-3xl border border-slate-800 bg-[#11151e] p-7 shadow-2xl sm:p-10">
        <p className="mt-8 text-xs font-extrabold tracking-[0.25em] text-amber-400">
          {isOrganizer ? "ORGANIZER WORKSPACE" : "GUEST ACCOUNT"}
        </p>
        <h1 className="mt-3 text-3xl font-black">
          {isOrganizer ? "Organizer sign in" : "Guest sign in"}
        </h1>
        <p className="mt-3 leading-7 text-slate-400">
          {isOrganizer
            ? "Sign in to create events, review guest applications, and manage check-in in the organizer workspace."
            : "Sign in to apply for guest lists and check your application status and QR code."}
        </p>

      <>
      <SocialAuthButtons next={returnTo} audience={audience} />
      <div className="mt-6 flex items-center gap-3 text-xs uppercase tracking-widest text-slate-500"><span className="h-px flex-1 bg-slate-800" />or use email<span className="h-px flex-1 bg-slate-800" /></div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <label className="block text-sm font-semibold">
            Email address
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-[#080b12] px-4 py-3 outline-none focus:border-amber-400"
            />
          </label>

          <label className="block text-sm font-semibold">
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your password"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-[#080b12] px-4 py-3 outline-none focus:border-amber-400"
            />
          </label>

          {error && (
            <p role="alert" className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="rounded-xl border border-emerald-900 bg-emerald-950/30 p-3 text-sm text-emerald-300">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-amber-400 px-5 py-4 font-bold text-black transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Signing in..." : isOrganizer ? "Open organizer workspace" : "Open guest dashboard"}
          </button>
        </form>

        {!isOrganizer && (
          <p className="mt-5 text-center text-sm text-slate-400">
            Applied as a guest?{" "}
            <Link href="/dashboard/access" className="font-semibold text-amber-400 underline underline-offset-4">Get a WhatsApp dashboard link</Link>
          </p>
        )}

        <p className="mt-6 text-center text-sm text-slate-400">
          New to Guestora?{" "}
          <Link href={signupHref} className="font-semibold text-amber-400 hover:text-amber-300">
            {isOrganizer ? "Create an organizer account" : "Create a guest account"}
          </Link>
        </p>
        <p className="mt-5 text-center text-sm text-slate-500">
          {isOrganizer ? "Looking for guest sign in?" : "Hosting an event?"}{" "}
          <Link
            href={isOrganizer ? "/login" : "/organizer/login"}
            className="font-semibold text-slate-300 underline underline-offset-4 hover:text-white"
          >
            {isOrganizer ? "Go to guest sign in" : "Go to organizer sign in"}
          </Link>
        </p>
        {isOrganizer && (
          <p className="mt-4 text-center text-sm text-slate-500">
            Guestora admin?{" "}
            <Link href="/admin/sign-in" className="font-semibold text-amber-400 underline underline-offset-4 hover:text-amber-300">Use the admin sign-in panel</Link>
          </p>
        )}
      </>
      </section>
    </main>
    </>
  );
}
