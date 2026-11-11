"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SiteHeader from "@/components/site-header";

type PublicEvent = {
  id: string;
  title: string;
  venue_name: string | null;
  city: string | null;
  state: string | null;
  description: string | null;
  capacity: number | null;
  application_opens_at: string | null;
  application_closes_at: string | null;
  application_link_closes_at: string | null;
  entry_starts_at: string | null;
  entry_deadline: string | null;
  entry_closed_at?: string | null;
};

type ApprovalCount = { approvedCount: number; capacity: number } | null;

export default function EventsPage() {
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [approvalCounts, setApprovalCounts] = useState<Record<string, ApprovalCount | undefined>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadEvents() {
      try {
        const response = await fetch("/api/events", { cache: "no-store" });
        const result = await response.json() as { events?: PublicEvent[]; error?: string };

        if (!active) return;
        if (!response.ok) {
          setError(result.error || "Events are temporarily unavailable. Please try again.");
          setEvents([]);
        } else {
          const publicEvents = result.events ?? [];
          setEvents(publicEvents);
          void Promise.all(publicEvents.map(async (event) => {
            try {
              const response = await fetch(`/api/events/${encodeURIComponent(event.id)}/approved-count`);
              if (!response.ok) return [event.id, null] as const;
              const result = await response.json() as { approvedCount?: number; capacity?: number };
              if (typeof result.approvedCount !== "number" || typeof result.capacity !== "number") return [event.id, null] as const;
              return [event.id, { approvedCount: result.approvedCount, capacity: result.capacity }] as const;
            } catch {
              return [event.id, null] as const;
            }
          })).then((entries) => {
            if (active) setApprovalCounts(Object.fromEntries(entries));
          });
        }
      } catch {
        if (!active) return;
        setError("Could not connect to Guestora. Check your connection and try again.");
        setEvents([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadEvents();
    return () => {
      active = false;
    };
  }, []);

  const filteredEvents = events.filter((event) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [event.title, event.city, event.state, event.venue_name]
      .some((value) => value?.toLowerCase().includes(query));
  });

  return (
    <main className="min-h-screen bg-[#080b12] text-white">
      <SiteHeader current="events" />

      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8">
        <p className="text-xs font-extrabold tracking-[0.25em] text-amber-400">GUEST LISTS</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-4xl font-black sm:text-5xl">Discover events</h1>
            <p className="mt-3 max-w-2xl leading-7 text-slate-400">Find an event, read the details, and apply for guest-list entry.</p>
          </div>
          <label className="w-full max-w-sm text-sm font-semibold text-slate-300">
            Search by event, venue, or city
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Try a city or venue"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-[#11151e] px-4 py-3 text-white outline-none focus:border-amber-400"
            />
          </label>
        </div>

        {error && <p role="alert" className="mt-8 rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-300">Could not load events: {error}</p>}

        {loading ? (
          <p className="mt-10 rounded-2xl border border-slate-800 bg-[#11151e] p-8 text-slate-400">Loading published events...</p>
        ) : !error && filteredEvents.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-slate-800 bg-[#11151e] p-8">
            <h2 className="text-xl font-bold">{events.length ? "No events match that search" : "No published events yet"}</h2>
            <p className="mt-2 leading-7 text-slate-400">Check back soon for new guest lists. Organizers can create and publish events from their workspace.</p>
            <Link href="/organizer/login" className="mt-5 inline-flex rounded-xl border border-slate-700 px-5 py-3 font-semibold hover:border-amber-400">Organizer sign in</Link>
          </div>
        ) : (
          <div className="mt-9 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {filteredEvents.map((event) => (
              <article key={event.id} className="flex flex-col rounded-2xl border border-slate-800 bg-[#11151e] p-6">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">Guest list</p>
                <h2 className="mt-3 text-2xl font-extrabold">{event.title}</h2>
                <p className="mt-2 text-slate-300">{event.venue_name || "Venue to be announced"}{[event.city, event.state].filter(Boolean).map((value) => ` · ${value}`).join("")}</p>
                {event.description?.trim() && event.description.trim() !== String(event.capacity ?? 200) && <p className="mt-4 line-clamp-3 flex-1 whitespace-pre-wrap leading-6 text-slate-400">{event.description}</p>}
                <div className="mt-5 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-300">Approved guests</p>
                  <p className="mt-1 text-3xl font-black tracking-tight text-amber-300">
                    {approvalCounts[event.id] ? `${approvalCounts[event.id]?.approvedCount}/${approvalCounts[event.id]?.capacity}` : `—/${event.capacity ?? 200}`}
                  </p>
                  <p className="text-xs text-slate-300">approved</p>
                  {approvalCounts[event.id] && (
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.min(100, ((approvalCounts[event.id]?.approvedCount ?? 0) / (approvalCounts[event.id]?.capacity ?? 200)) * 100)}%` }} />
                    </div>
                  )}
                </div>
                <div className="mt-4 space-y-1 rounded-xl border border-slate-800 bg-[#0b0e15] p-3 text-xs text-slate-300">
                  <p>Registration starts: <span className="font-semibold text-white">{event.application_opens_at ? new Date(event.application_opens_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Not set"}</span></p>
                  <p>Registration closes: <span className="font-semibold text-white">{(event.application_link_closes_at ?? event.application_closes_at) ? new Date((event.application_link_closes_at ?? event.application_closes_at)!).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Not set"}</span></p>
                  <p>Entry starts: <span className="font-semibold text-white">{event.entry_starts_at ? new Date(event.entry_starts_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Not set"}</span></p>
                  <p>Entry closes: <span className="font-semibold text-white">{(event.entry_closed_at ?? event.entry_deadline) ? new Date((event.entry_closed_at ?? event.entry_deadline)!).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Not set"}</span></p>
                </div>
                <Link href={`/events/${event.id}`} className="mt-6 inline-flex justify-center rounded-xl bg-amber-400 px-5 py-3 font-bold text-black hover:bg-amber-300">View event & apply</Link>
              </article>
            ))}
          </div>
        )}

        <p className="mt-10 text-sm text-slate-500">Guest-list applications need organizer approval. An application is not a ticket purchase.</p>
      </div>
    </main>
  );
}
