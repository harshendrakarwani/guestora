
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import SiteHeader from "@/components/site-header";
import SocialAuthButtons from "@/components/social-auth-buttons";
import { addAccountRolePatch, getAccountRoles, hasAccountRole } from "@/lib/account-roles";

function GuestSignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const requestedNext = searchParams.get("next");
  const returnTo = requestedNext && /^\/events\/[a-zA-Z0-9-]+$/.test(requestedNext)
    ? requestedNext
    : "/dashboard";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [needsAccountSwitch, setNeedsAccountSwitch] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const user = data.session?.user;
      const roles = getAccountRoles(user?.user_metadata);
      if (user && hasAccountRole(user.user_metadata, "guest")) {
        window.location.replace("/dashboard");
        return;
      }
      setNeedsAccountSwitch(Boolean(user && roles.length > 0));
      setCheckingSession(false);
    });
    return () => { active = false; };
  }, [supabase]);

  async function continueToGuestWorkspace() {
    setError("");
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data.user) {
      setError(`Could not confirm your account${userError ? `: ${userError.message}` : ". Please sign in again."}`);
      return;
    }
    const { error: roleError } = await supabase.auth.updateUser({ data: addAccountRolePatch(data.user.user_metadata, "guest") });
    if (roleError) { setError(`Could not enable the guest workspace: ${roleError.message}`); return; }
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !hasAccountRole(refreshed.session?.user.user_metadata, "guest")) {
      setError(`Could not confirm guest workspace access${refreshError ? `: ${refreshError.message}` : ". Please try again."}`);
      return;
    }
    window.location.replace(returnTo);
  }
  async function handleSignup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const emailRedirect = new URL("/auth/callback", window.location.origin);
      emailRedirect.searchParams.set("audience", "guest");
      emailRedirect.searchParams.set("next", returnTo);
      const { data, error: signupError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
            role: "guest",
            roles: ["guest"],
          },
          emailRedirectTo: emailRedirect.toString(),
        },
      });

      if (signupError) throw signupError;

      if (!data.session && data.user?.identities?.length === 0) {
        setMessage("This email already has a Guestora account. Sign in with it to open your guest workspace.");
        return;
      }

      if (data.session) {
        setMessage("Account created successfully. Redirecting...");
        router.replace(returnTo);
        router.refresh();
      } else {
        setMessage(
          "Account created. Check your email to confirm your account before signing in."
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to create your account."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
    <SiteHeader />
    <main className="flex min-h-screen items-center justify-center bg-[#080b12] px-5 py-12 text-white">
      <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-[#11151e] p-8">
        <p className="mt-8 text-sm font-bold uppercase tracking-[0.25em] text-amber-400">
          Guest registration
        </p>

        <h1 className="mt-3 text-3xl font-black">Create your account</h1>
        <p className="mt-2 text-slate-400">
          Sign up to apply for guest lists and track your applications.
        </p>

        {checkingSession ? (
          <p className="mt-8 text-center text-sm text-slate-400">Checking your sign-in...</p>
        ) : needsAccountSwitch ? (
          <div className="mt-8 space-y-4">
            <p role="status" className="rounded-xl border border-amber-700/60 bg-amber-950/30 p-4 text-sm text-amber-200">You’re signed in already. Continue with this account to open the guest workspace.</p>
            <button type="button" onClick={() => void continueToGuestWorkspace()} className="w-full rounded-xl bg-amber-400 px-5 py-4 font-bold text-black hover:bg-amber-300">Continue to guest workspace</button>
          </div>
        ) : <>
        <SocialAuthButtons next={returnTo} audience="guest" />
        <div className="mt-6 flex items-center gap-3 text-xs uppercase tracking-widest text-slate-500"><span className="h-px flex-1 bg-slate-800" />or use email<span className="h-px flex-1 bg-slate-800" /></div>

        <form onSubmit={handleSignup} className="mt-8 space-y-5">
          <div>
            <label htmlFor="name" className="mb-2 block text-sm">
              Full name
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-[#080b12] px-4 py-3 outline-none focus:border-amber-400"
              placeholder="Enter your full name"
            />
          </div>

          <div>
            <label htmlFor="email" className="mb-2 block text-sm">
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-[#080b12] px-4 py-3 outline-none focus:border-amber-400"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-2 block text-sm">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-[#080b12] px-4 py-3 outline-none focus:border-amber-400"
              placeholder="At least 8 characters"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-xl bg-red-950 p-3 text-sm text-red-300">
              {error}
            </p>
          )}

          {message && (
            <p role="status" className="rounded-xl bg-slate-900 p-3 text-sm text-amber-300">
            {message}
            {message.startsWith("This email already") && <> <Link href={`/login?next=${encodeURIComponent(returnTo)}`} className="font-semibold underline underline-offset-2">Sign in</Link></>}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-amber-400 px-5 py-4 font-bold text-black disabled:opacity-60"
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          Already registered?{" "}
          <Link href={`/login?next=${encodeURIComponent(returnTo)}`} className="font-semibold text-amber-400">
            Sign in
          </Link>
        </p>

        <p className="mt-5 text-center text-xs text-slate-500">
          Guest-list applications require organizer approval. This is not a ticket purchase.
        </p>
        </>}
      </section>
    </main>
    </>
  );
}

export default function GuestSignupPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#080b12]" />}>
      <GuestSignupForm />
    </Suspense>
  );
}
