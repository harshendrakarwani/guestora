import Link from "next/link";
import ClaimDashboardButton from "@/components/claim-dashboard-button";
import SiteHeader from "@/components/site-header";

export default async function ClaimGuestDashboardLink({ params }: PageProps<"/dashboard/access/claim/[token]">) {
  const { token } = await params;
  return (
    <>
    <SiteHeader current="dashboard" />
    <main className="flex min-h-screen items-center justify-center bg-[#080b12] px-5 py-12 text-white">
      <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-[#11151e] p-7 shadow-2xl sm:p-9">
        <p className="mt-8 text-xs font-extrabold tracking-[0.25em] text-amber-400">GUEST DASHBOARD</p>
        <h1 className="mt-3 text-3xl font-black">Open your applications</h1>
        <p className="mt-3 leading-7 text-slate-400">This secure link was sent to the email address used for guest applications. Continue to open the dashboard on this device.</p>
        <ClaimDashboardButton token={token} />
        <p className="mt-5 text-center text-sm text-slate-400"><Link href="/dashboard/access" className="font-semibold text-amber-400 underline underline-offset-4">Request a new link</Link></p>
      </section>
    </main>
    </>
  );
}
