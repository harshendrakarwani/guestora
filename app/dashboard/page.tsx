"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { createClient } from "@/lib/supabase-browser";
import { hasAccountRole } from "@/lib/account-roles";
import SiteHeader from "@/components/site-header";

type UserInfo = { id?: string; email?: string; phone?: string; full_name?: string; user_metadata?: { full_name?: string; role?: string } };
type ApplicationEvent = { title: string; venue_name: string | null; city: string | null; state: string | null };
type ApplicationItem = {
  id: string;
  event_id: string;
  guest_name?: string | null;
  status: string;
  application_fee_paise: number;
  payment_status: string;
  check_in_token: string | null;
  created_at: string;
  guest_avatar_url?: string | null;
  instagram_username?: string | null;
  events: ApplicationEvent | null;
};

export default function DashboardPage() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [applications, setApplications] = useState<ApplicationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [applicationsLoading, setApplicationsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    async function loadGuestDashboard() {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;
      const signedInUser = data.session?.user;
      let phoneAccess: { email?: string | null; phone?: string; applications?: ApplicationItem[] } | null = null;
      let phoneAccessError = "";
      try {
        const response = await fetch("/api/guest/dashboard/applications", { cache: "no-store" });
        const result = await response.json().catch(() => ({})) as { error?: string; email?: string | null; phone?: string; applications?: ApplicationItem[] };
        if (!active) return;
        if (response.ok) phoneAccess = result;
        else if (response.status !== 401) phoneAccessError = result.error || "Unable to load your applications.";
      } catch {
        phoneAccessError = "Could not load your applications. Refresh and try again.";
      }

      // A valid emailed guest link takes priority, so opening it works even
      // when this browser is signed in to a different Guestora workspace.
      if (phoneAccess) {
        let visibleApplications = phoneAccess.applications ?? [];
        if (!sessionError && signedInUser && hasAccountRole(signedInUser.user_metadata, "guest")) {
          const { data: accountRows } = await supabase.from("guest_applications")
            .select("id, event_id, status, application_fee_paise, payment_status, check_in_token, created_at, guest_avatar_url, instagram_username, events(title, venue_name, city, state)")
            .eq("guest_id", signedInUser.id)
            .order("created_at", { ascending: false })
            .limit(200);
          const combined = [...visibleApplications, ...((accountRows ?? []) as unknown as ApplicationItem[])];
          visibleApplications = [...new Map(combined.map((application) => [application.id, application])).values()];
        }
        if (!active) return;
        setUser({ email: phoneAccess.email ?? undefined, phone: phoneAccess.phone, full_name: phoneAccess.applications?.[0]?.guest_name || "Guest" });
        setApplications(visibleApplications);
        setLoading(false);
        setApplicationsLoading(false);
        return;
      }

      if (!sessionError && signedInUser && hasAccountRole(signedInUser.user_metadata, "guest")) {
        setUser({ id: signedInUser.id, email: signedInUser.email, user_metadata: signedInUser.user_metadata });
        setLoading(false);
        const { data: rows, error } = await supabase.from("guest_applications")
          .select("id, event_id, status, application_fee_paise, payment_status, check_in_token, created_at, guest_avatar_url, instagram_username, events(title, venue_name, city, state)")
          .eq("guest_id", signedInUser.id)
          .order("created_at", { ascending: false })
          .limit(200);
        if (!active) return;
        if (error) {
          setErrorMessage(`Unable to load your applications: ${error.message}`);
          setApplications([]);
        } else {
          setErrorMessage("");
          setApplications((rows ?? []) as unknown as ApplicationItem[]);
        }
        setApplicationsLoading(false);
        return;
      }

      if (signedInUser) {
        window.location.replace("/login?error=wrong_account_type");
        return;
      }
      if (!phoneAccessError) {
      window.location.replace("/dashboard/access");
        return;
      }
      setErrorMessage(phoneAccessError);
      if (active) {
        setLoading(false);
        setApplicationsLoading(false);
      }
    }

    void loadGuestDashboard();
    return () => { active = false; };
  }, []);

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-[#080b12] text-white"><p className="text-slate-400">Loading your guest dashboard...</p></main>;
  }

  const displayName = user?.user_metadata?.full_name?.trim() || user?.full_name?.trim() || user?.email?.split("@")[0] || "Guest";

  return (
    <main className="min-h-screen bg-[#080b12] text-white">
      <SiteHeader
        current="dashboard"
        actions={!user?.id ? <span className="rounded-full border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300">{user?.email ? "Email access" : "Guest access"}</span> : undefined}
      />

      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8">
        <section>
          <p className="text-xs font-extrabold tracking-[0.25em] text-amber-400">GUEST DASHBOARD</p>
          <h1 className="mt-4 text-4xl font-black sm:text-5xl">Welcome, {displayName}.</h1>
          <p className="mt-4 max-w-2xl leading-7 text-slate-400">Follow your guest-list applications here. When an organizer approves you, your entry QR code appears on that application.</p>
          {user?.email && <p className="mt-2 text-sm text-slate-500">Guest applications for {user.email}</p>}
          {!user?.email && user?.phone && <p className="mt-2 text-sm text-slate-500">Guest applications for WhatsApp number ending in {user.phone.slice(-4)}</p>}
          <Link href="/events" className="mt-6 inline-flex rounded-xl bg-amber-400 px-5 py-3 font-bold text-black hover:bg-amber-300">Browse events</Link>
        </section>

        <section className="mt-8 flex flex-col gap-4 rounded-2xl border border-amber-500/30 bg-[#11151e] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="text-lg font-bold">Want to host an event?</h2>
            <p className="mt-1 text-sm leading-6 text-slate-400">Open the organizer workspace with your Guestora account.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/organizer/login" className="min-h-11 rounded-xl bg-amber-400 px-4 py-3 text-center text-sm font-bold text-black hover:bg-amber-300">Organizer sign in</Link>
            <Link href="/organizer/signup" className="min-h-11 rounded-xl border border-slate-700 px-4 py-3 text-center text-sm font-semibold hover:border-amber-400">Create organizer account</Link>
          </div>
        </section>

        <section className="mt-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><h2 className="text-2xl font-bold">My applications</h2><p className="mt-2 text-sm text-slate-400">Application updates and approved entry QR codes.</p></div>
            <button onClick={() => window.location.reload()} className="rounded-xl border border-slate-700 px-5 py-3 font-bold hover:border-amber-400">Refresh</button>
          </div>
          {errorMessage && <p role="alert" className="mt-6 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">{errorMessage}</p>}
          {applicationsLoading ? (
            <p className="mt-6 rounded-2xl border border-slate-800 bg-[#11151e] p-8 text-slate-400">Loading applications...</p>
          ) : errorMessage ? null : applications.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-slate-800 bg-[#11151e] p-8"><h3 className="text-xl font-bold">No applications yet</h3><p className="mt-2 leading-7 text-slate-400">Browse published events and apply to a guest list. Your applications will show up here.</p><Link href="/events" className="mt-5 inline-flex rounded-xl bg-amber-400 px-5 py-3 font-bold text-black hover:bg-amber-300">Discover events</Link></div>
          ) : (
            <div className="mt-6 grid gap-5 md:grid-cols-2">
              {applications.map((application) => {
                const event = application.events;
                return (
                  <article key={application.id} className="rounded-2xl border border-slate-800 bg-[#11151e] p-6">
                    {(application.guest_avatar_url || application.instagram_username) && <div className="mb-4 flex items-center gap-3">{application.guest_avatar_url ? <img src={application.guest_avatar_url} alt="Guest profile" className="h-12 w-12 rounded-full object-cover" /> : <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 font-bold">{(application.guest_name || "G").slice(0, 1).toUpperCase()}</span>}{application.instagram_username && <a href={`https://instagram.com/${encodeURIComponent(application.instagram_username)}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-amber-400">@{application.instagram_username}</a>}</div>}
                    <h3 className="text-xl font-extrabold">{event?.title || "Event"}</h3>
                    <p className="mt-2 text-slate-400">{event?.venue_name || "Venue not specified"}{[event?.city, event?.state].filter(Boolean).map((value) => ` · ${value}`).join("")}</p>
                    <p className="mt-5">Application status: <span className="font-bold capitalize text-amber-400">{application.status}</span></p>
                    <p className="mt-2 text-sm text-slate-300">Application fee: ₹{application.application_fee_paise / 100} · Payment: <span className="capitalize">{application.payment_status}</span></p>
                    <p className="mt-3 text-xs text-slate-500">Applied {new Date(application.created_at).toLocaleString("en-IN")}</p>
                    {application.status === "approved" && application.check_in_token && <div className="mt-6 rounded-2xl bg-white p-5 text-center"><p className="mb-4 font-bold text-slate-900">Your event check-in QR</p><div className="flex justify-center"><QRCodeSVG value={application.check_in_token} size={220} level="M" includeMargin /></div><p className="mt-4 text-sm text-slate-700">Show this QR to the event team at the entrance.</p></div>}
                    {application.status === "approved" && !application.check_in_token && <p className="mt-5 rounded-xl border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-200">Your application is approved, but its QR is not ready yet. Refresh this page in a moment.</p>}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
