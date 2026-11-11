import type { ReactNode } from "react";
import Link from "next/link";
import GuestAccountActions from "@/components/guest-account-actions";

type SiteHeaderProps = {
  area?: "guest" | "organizer";
  current?: string;
  actions?: ReactNode;
};

const guestLinks = [
  { href: "/events", label: "Discover events", key: "events" },
  { href: "/dashboard", label: "Guest dashboard", key: "dashboard" },
  { href: "/organizer/login", label: "Organizer sign in", key: "organizer" },
  { href: "/support", label: "Help", key: "support" },
];

const organizerLinks = [
  { href: "/events", label: "Browse events", key: "events" },
  { href: "/organizer", label: "Events workspace", key: "organizer" },
  { href: "/organizer/check-in", label: "Check in", key: "check-in" },
  { href: "/support", label: "Help", key: "support" },
];

export default function SiteHeader({ area = "guest", current, actions }: SiteHeaderProps) {
  const links = area === "organizer" ? organizerLinks : guestLinks;

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#0b0e15]/95 text-white shadow-lg shadow-black/10 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-5 gap-y-3 px-4 py-3 sm:px-8 sm:py-4">
        <Link
          href="/"
          aria-label="Guestora home"
          title="Go to Guestora home"
          className="shrink-0 rounded-lg text-xl font-black tracking-tight transition hover:text-amber-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-400 sm:text-2xl"
        >
          Guestora<span className="text-amber-400">.</span>
        </Link>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <nav aria-label="Main navigation" className="flex flex-wrap items-center justify-end gap-1 sm:gap-2">
            {links.map((link) => {
              const active = current === link.key || (link.key === "organizer" && current === "applicants");
              return (
                <Link
                  key={link.key}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex min-h-10 items-center justify-center rounded-full border px-3 py-2 text-xs font-semibold transition sm:px-4 sm:text-sm ${
                    active
                      ? "border-amber-400/50 bg-amber-400/10 text-amber-200"
                      : "border-transparent text-slate-300 hover:border-slate-700 hover:bg-[#11151e] hover:text-white"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
          {area === "guest" && <GuestAccountActions showHelp={false} />}
          {actions}
        </div>
      </div>
    </header>
  );
}
