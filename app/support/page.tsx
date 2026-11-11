import Link from "next/link";
import SiteHeader from "@/components/site-header";

export const metadata = { title: "Support | Guestora", description: "Contact Guestora support and review event listing and guest-list payment terms." };

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-[#080b12] text-white">
      <SiteHeader current="support" />
      <div className="mx-auto max-w-3xl px-5 py-10 sm:py-16">
        <section className="rounded-3xl border border-slate-800 bg-[#11151e] p-6 sm:p-10">
          <p className="text-xs font-extrabold tracking-[0.25em] text-amber-400">WE’RE HERE TO HELP</p>
          <h1 className="mt-3 text-4xl font-black">Guestora support</h1>
          <p className="mt-4 leading-7 text-slate-300">For payment, account, event listing, or guest-list questions, contact us and include the event name and payment reference if relevant.</p>
          <div className="mt-7 grid gap-4 sm:grid-cols-2">
            <a href="mailto:info@guestora.in" className="rounded-2xl border border-slate-700 p-5 hover:border-amber-400">
              <span className="text-sm text-slate-400">Email</span><span className="mt-2 block break-all font-bold">info@guestora.in</span>
            </a>
            <a href="tel:+917300300511" className="rounded-2xl border border-slate-700 p-5 hover:border-amber-400">
              <span className="text-sm text-slate-400">Phone</span><span className="mt-2 block font-bold">+91 73003 00511</span>
            </a>
          </div>
          <h2 className="mt-9 text-xl font-bold">Fees and entry</h2>
          <ul className="mt-3 space-y-3 leading-7 text-slate-300">
            <li>Organizers pay a ₹250 event listing fee before an event can be published. This fee is non-refundable. Organizers can continue editing event details after listing without losing the listing.</li>
            <li>Guests pay ₹30 per guest-list application. An application is submitted for organizer review only after payment is confirmed. If an organizer rejects a paid application, Guestora initiates a full refund to the original payment method.</li>
            <li>After the event’s published guest-list entry/QR scan deadline, organizers may deny entry. No refund is provided for late arrival or entry denied after that deadline.</li>
          </ul>
          <p className="mt-7 text-sm leading-6 text-slate-500">Payments are securely processed by Razorpay. A payment confirmation does not guarantee event entry; the organizer makes the approval and venue-entry decisions.</p>
          <Link href="/events" className="mt-8 inline-flex rounded-xl bg-amber-400 px-5 py-3 font-bold text-black">Browse events</Link>
        </section>
      </div>
    </main>
  );
}
