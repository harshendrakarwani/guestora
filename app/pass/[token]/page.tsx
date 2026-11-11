import { notFound } from "next/navigation";
import GuestPassQr from "@/components/guest-pass-qr";
import { createAdminClient } from "@/lib/supabase-admin";
import SiteHeader from "@/components/site-header";

type GuestPassPageProps = {
  params: Promise<{ token: string }>;
};

function displayTime(value: string | null): string {
  if (!value) return "Not specified";
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
}

export default async function GuestPassPage({ params }: GuestPassPageProps) {
  const { token } = await params;
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(token)) notFound();

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return (
      <>
      <SiteHeader current="dashboard" />
      <main className="flex min-h-screen items-center justify-center bg-[#080b12] px-5 text-white">
        <div className="max-w-lg rounded-2xl border border-slate-800 bg-[#11151e] p-8 text-center">
          <h1 className="text-2xl font-bold">Guest pass temporarily unavailable</h1>
          <p className="mt-3 leading-7 text-slate-400">
            Guestora has not finished its secure pass-page setup. Please open your guest dashboard or contact the event organizer.
          </p>
        </div>
      </main>
      </>
    );
  }

  const { data: application, error } = await admin
    .from("guest_applications")
    .select("event_id, guest_name, guest_email, check_in_token, status")
    .eq("check_in_token", token)
    .maybeSingle();

  if (error || !application || application.status !== "approved") notFound();

  const { data: event } = await admin
    .from("events")
    .select("title, venue_name, city, state, entry_starts_at, entry_deadline")
    .eq("id", application.event_id)
    .maybeSingle();

  if (!event) notFound();

  return (
    <>
    <SiteHeader current="dashboard" />
    <main className="min-h-screen bg-[#080b12] px-5 py-10 text-white">
      <div className="mx-auto max-w-xl">
        <section className="mt-8 rounded-3xl border border-slate-800 bg-[#11151e] p-6 sm:p-9">
          <p className="text-xs font-extrabold tracking-[0.25em] text-amber-400">
            APPROVED GUEST PASS
          </p>
          <h1 className="mt-3 text-3xl font-black">{event.title}</h1>
          <p className="mt-2 text-slate-300">
            {[event.venue_name, event.city, event.state].filter(Boolean).join(" · ") ||
              "Venue to be announced"}
          </p>
          {application.guest_email && (
            <p className="mt-3 text-sm text-slate-400">Guest: {application.guest_name || application.guest_email}</p>
          )}

          <div className="mt-6">
            <GuestPassQr token={token} />
          </div>

          <p className="mt-5 text-center text-sm text-slate-300">
            Show this QR to the event team at the entrance. It can be scanned once.
          </p>
          {event.entry_starts_at && (
            <p className="mt-4 text-center text-sm text-slate-400">
              Guest list entry starts at: {displayTime(event.entry_starts_at)}
            </p>
          )}
          {event.entry_deadline && (
            <p className="mt-2 text-center text-sm text-slate-400">
              Guest list entry closes at: {displayTime(event.entry_deadline)}
            </p>
          )}
        </section>
      </div>
    </main>
    </>
  );
}
