"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import SocialAuthButtons from "@/components/social-auth-buttons";
import SiteHeader from "@/components/site-header";
import { addAccountRolePatch, getAccountRoles, hasAccountRole } from "@/lib/account-roles";

export default function OrganizerSignupPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
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
      if (user && hasAccountRole(user.user_metadata, "organizer")) {
        window.location.replace("/organizer");
        return;
      }
      setNeedsAccountSwitch(Boolean(user && roles.length > 0));
      setCheckingSession(false);
    });
    return () => { active = false; };
  }, [supabase]);

  async function continueToOrganizerWorkspace() {
    setError("");
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data.user) {
      setError(`Could not confirm your account${userError ? `: ${userError.message}` : ". Please sign in again."}`);
      return;
    }
    const { error: roleError } = await supabase.auth.updateUser({ data: addAccountRolePatch(data.user.user_metadata, "organizer") });
    if (roleError) { setError(`Could not enable the organizer workspace: ${roleError.message}`); return; }
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !hasAccountRole(refreshed.session?.user.user_metadata, "organizer")) {
      setError(`Could not confirm organizer workspace access${refreshError ? `: ${refreshError.message}` : ". Please try again."}`);
      return;
    }
    window.location.replace("/organizer");
  }

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const emailRedirect = new URL("/auth/callback", window.location.origin);
      emailRedirect.searchParams.set("audience", "organizer");
      emailRedirect.searchParams.set("next", "/organizer");
      const { data, error: signupError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: name.trim(), role: "organizer", roles: ["organizer"] },
          emailRedirectTo: emailRedirect.toString(),
        },
      });

      if (signupError) throw signupError;

      // Supabase intentionally returns a successful-looking response for an
      // email that already exists. Keep the workspaces separate and direct the
      // person to an existing organizer account or a different email address.
      if (!data.session && data.user?.identities?.length === 0) {
        setMessage("This email already has a Guestora account. Sign in with it to open your organizer workspace.");
        return;
      }

      if (data.session) {
        setMessage("Organizer account created. Opening your workspace...");
        router.replace("/organizer");
        router.refresh();
      } else {
        setMessage("Account created. Confirm your email, then sign in as an organizer.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create your account.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
    <SiteHeader area="organizer" />
    <main className="flex min-h-screen items-center justify-center bg-[#080b12] px-5 py-10 text-white">
      <section className="w-full max-w-lg rounded-3xl border border-slate-800 bg-[#11151e] p-7 shadow-2xl sm:p-10">
        <p className="mt-8 text-xs font-extrabold tracking-[0.25em] text-amber-400">ORGANIZER WORKSPACE</p>
        <h1 className="mt-3 text-3xl font-black">Create an organizer account</h1>
        <p className="mt-3 leading-7 text-slate-400">Create a separate organizer account to publish events, review guest applications, and manage guest entry. Guest and organizer accounts use separate sign-in workspaces.</p>

        {checkingSession ? (
          <p className="mt-8 text-center text-sm text-slate-400">Checking your sign-in...</p>
        ) : needsAccountSwitch ? (
          <div className="mt-8 space-y-4">
            <p role="status" className="rounded-xl border border-amber-700/60 bg-amber-950/30 p-4 text-sm text-amber-200">You’re signed in already. Continue with this account to open the organizer workspace.</p>
            <button type="button" onClick={() => void continueToOrganizerWorkspace()} className="w-full rounded-xl bg-amber-400 px-5 py-4 font-bold text-black hover:bg-amber-300">Continue to organizer workspace</button>
          </div>
        ) : <>
        <SocialAuthButtons next="/organizer" audience="organizer" />
        <div className="mt-6 flex items-center gap-3 text-xs uppercase tracking-widest text-slate-500"><span className="h-px flex-1 bg-slate-800" />or use email<span className="h-px flex-1 bg-slate-800" /></div>

        <form onSubmit={handleSignup} className="mt-8 space-y-5">
          <label className="block text-sm font-semibold">
            Your name
            <input
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your full name"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-[#080b12] px-4 py-3 outline-none focus:border-amber-400"
            />
          </label>
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
              autoComplete="new-password"
              minLength={6}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 6 characters"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-[#080b12] px-4 py-3 outline-none focus:border-amber-400"
            />
          </label>

          {error && <p role="alert" className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}
          {message && <p role="status" className="rounded-xl border border-emerald-900 bg-emerald-950/30 p-3 text-sm text-emerald-300">{message}{message.startsWith("This email already") && <> <Link href="/organizer/login" className="font-semibold underline underline-offset-2">Sign in</Link></>}</p>}

          <button type="submit" disabled={loading} className="w-full rounded-xl bg-amber-400 px-5 py-4 font-bold text-black transition hover:bg-amber-300 disabled:opacity-60">
            {loading ? "Creating account..." : "Create organizer account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          Already have an organizer account? <Link href="/organizer/login" className="font-semibold text-amber-400">Sign in</Link>
        </p>
        </>}
        <p className="mt-4 text-center text-sm text-slate-500">
          Applying to events? <Link href="/signup" className="font-semibold text-slate-300 underline underline-offset-4">Create a guest account</Link>
        </p>
      </section>
    </main>
    </>
  );
}
