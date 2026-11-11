"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { hasAccountRole } from "@/lib/account-roles";

type GuestUser = {
  email?: string;
  name: string;
  avatarUrl: string;
};

function PersonIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="3.5"/><path strokeLinecap="round" d="M5 20c.7-3.4 3.1-5.2 7-5.2s6.3 1.8 7 5.2"/></svg>;
}

function HelpIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path strokeLinecap="round" strokeLinejoin="round" d="M9.6 9a2.5 2.5 0 1 1 4.3 1.8c-1.2 1.1-1.9 1.3-1.9 2.7M12 17h.01"/></svg>;
}

export default function GuestAccountActions({ showHelp = true }: { showHelp?: boolean }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [guest, setGuest] = useState<GuestUser | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const applyUser = (user: { email?: string; user_metadata?: Record<string, unknown> } | null) => {
      if (!active) return;
      if (!user || !hasAccountRole(user.user_metadata, "guest")) {
        setGuest(null);
        return;
      }
      const metadata = user.user_metadata ?? {};
      setGuest({
        email: user.email,
        name: String(metadata.full_name ?? metadata.name ?? "").trim() || user.email?.split("@")[0] || "Guest",
        avatarUrl: String(metadata.avatar_url ?? ""),
      });
    };

    void supabase.auth.getUser().then(({ data }) => applyUser(data.user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => applyUser(session?.user ?? null));
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function signOut() {
    await supabase.auth.signOut();
    setOpen(false);
    router.push("/");
  }

  return (
    <div className="flex items-center gap-2">
      {showHelp && (
        <Link href="/support" aria-label="Help and contact us" title="Help and contact us" className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 text-slate-200 transition hover:border-amber-400 hover:text-amber-300">
          <HelpIcon />
        </Link>
      )}
      <div className="relative">
        {guest ? (
          <>
            <button type="button" aria-label="Open account menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="inline-flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-slate-700 bg-[#11151e] text-slate-100 transition hover:border-amber-400">
              {guest.avatarUrl ? <img src={guest.avatarUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : <PersonIcon />}
            </button>
            {open && (
              <div className="absolute right-0 top-14 z-50 w-72 rounded-2xl border border-slate-700 bg-[#11151e] p-4 shadow-2xl">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Signed in as</p>
                <p className="mt-1 truncate font-bold text-white">{guest.name}</p>
                {guest.email && <p className="mt-1 truncate text-sm text-slate-400">{guest.email}</p>}
                <div className="my-3 border-t border-slate-800" />
                <Link onClick={() => setOpen(false)} href="/dashboard" className="block rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800">Guest dashboard</Link>
                <Link onClick={() => setOpen(false)} href="/profile" className="block rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800">Edit profile</Link>
                <button type="button" onClick={() => void signOut()} className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-400 hover:bg-slate-800 hover:text-white">Sign out</button>
              </div>
            )}
          </>
        ) : (
          <Link href="/login" aria-label="Guest sign in" title="Guest sign in" className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 text-slate-200 transition hover:border-amber-400 hover:text-amber-300">
            <PersonIcon />
          </Link>
        )}
      </div>
    </div>
  );
}
