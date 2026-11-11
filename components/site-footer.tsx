import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="mt-auto w-full border-t border-slate-800 bg-[#0d1018] px-5 py-5 text-sm text-slate-400 sm:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-3 text-center sm:flex-row sm:text-left">
        <span>© {new Date().getFullYear()} Guestora</span>
        <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <Link href="/events" className="hover:text-white">Browse events</Link>
          <Link href="/organizer/login" className="hover:text-white">For organizers</Link>
          <Link href="/support" className="hover:text-white">Support</Link>
          <span className="text-slate-300">Designed &amp; Developed by <span className="font-semibold text-white">Harsh Karwani</span></span>
        </nav>
      </div>
    </footer>
  );
}
