import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import SiteHeader from "@/components/site-header";

const audiences = [
  {
    eyebrow: "FOR GUESTS",
    title: "Find your next event.",
    description:
      "Browse guest lists, apply for entry, and follow your approval in one place.",
    primary: "Explore events",
    primaryHref: "/events",
    secondary: "Guest sign in",
    secondaryHref: "/login",
    signup: "New here? Create a guest account",
    signupHref: "/signup",
  },
  {
    eyebrow: "FOR ORGANIZERS",
    title: "Bring your guest list together.",
    description:
      "Publish events, review applications, and check approved guests in with QR codes.",
    primary: "Organizer sign in",
    primaryHref: "/organizer/login",
    secondary: "Create organizer account",
    secondaryHref: "/organizer/signup",
    signup: "Manage events and guest entry",
    signupHref: "/organizer/login",
  },
];

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const code = Array.isArray(params.code) ? params.code[0] : params.code;

  // Older Supabase confirmation emails can fall back to the homepage with
  // ?code=... . Forward them through the route that exchanges the code and
  // stores the authenticated session cookies.
  if (code) {
    const cookieStore = await cookies();
    const fallbackAudience = cookieStore.get("guestora_auth_audience")?.value;
    const requestedNext = Array.isArray(params.next) ? params.next[0] : params.next;
    const cookieNextValue = cookieStore.get("guestora_auth_next")?.value;
    let cookieNext = "";
    try {
      cookieNext = cookieNextValue ? decodeURIComponent(cookieNextValue) : "";
    } catch {
      cookieNext = "";
    }
    const isAdminSignIn = requestedNext === "/organizer/commission/admin" || cookieNext === "/organizer/commission/admin";
    const audience = isAdminSignIn || params.audience === "organizer" || (!params.audience && fallbackAudience === "organizer")
      ? "organizer"
      : "guest";
    const next = audience === "organizer"
      ? requestedNext === "/organizer/commission/admin" || cookieNext === "/organizer/commission/admin"
        ? "/organizer/commission/admin"
        : "/organizer"
      : requestedNext && /^\/events\/[a-zA-Z0-9-]+$/.test(requestedNext)
        ? requestedNext
        : cookieNext && /^\/events\/[a-zA-Z0-9-]+$/.test(cookieNext)
          ? cookieNext
          : "/dashboard";
    const callback = new URLSearchParams({ code, audience, next });
    redirect(`/auth/callback?${callback.toString()}`);
  }

  return (
    <main className="min-h-screen bg-[#080b12] text-white">
      <SiteHeader current="home" />

      <section className="mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <div>
          <p className="text-xs font-extrabold tracking-[0.3em] text-amber-400 sm:text-sm">
            YOUR EVENT. YOUR GUEST LIST.
          </p>
          <h1 className="mt-6 max-w-3xl text-4xl font-black leading-[1.04] tracking-tight sm:text-6xl lg:text-7xl">
            Great nights start with the <span className="text-amber-400">right guest list.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-400 sm:text-xl">
            Guestora connects people with events and gives event teams one clear place to manage guest-list entry.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 text-sm text-slate-300">
            <span className="rounded-full border border-slate-800 px-4 py-2">Apply for entry</span>
            <span className="rounded-full border border-slate-800 px-4 py-2">Track approval</span>
            <span className="rounded-full border border-slate-800 px-4 py-2">Check in with QR</span>
          </div>
        </div>

        <div className="grid gap-5">
          {audiences.map((audience, index) => (
            <article
              key={audience.eyebrow}
              className={`rounded-3xl border p-6 sm:p-8 ${index === 0 ? "border-slate-800 bg-[#11151e]" : "border-amber-500/30 bg-gradient-to-br from-[#171820] to-[#11151e]"}`}
            >
              <p className="text-xs font-extrabold tracking-[0.25em] text-amber-400">
                {audience.eyebrow}
              </p>
              <h2 className="mt-4 text-2xl font-extrabold sm:text-3xl">{audience.title}</h2>
              <p className="mt-3 max-w-xl leading-7 text-slate-400">{audience.description}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href={audience.primaryHref} className="rounded-xl bg-amber-400 px-5 py-3 font-bold text-black transition hover:bg-amber-300">
                  {audience.primary}
                </Link>
                <Link href={audience.secondaryHref} className="rounded-xl border border-slate-700 px-5 py-3 font-semibold transition hover:border-amber-400">
                  {audience.secondary}
                </Link>
              </div>
              {index === 0 && (
                <p className="mt-5 text-sm text-slate-400">
                  {audience.signup.split("? ")[0]}?{" "}
                  <Link href={audience.signupHref} className="font-semibold text-slate-300 underline decoration-slate-600 underline-offset-4 hover:text-white">
                    Create a guest account
                  </Link>
                </p>
              )}
              {index === 1 && (
                <p className="mt-5 text-sm text-slate-400">
                  New to Guestora?{" "}
                  <Link href={audience.secondaryHref} className="font-semibold text-slate-300 underline decoration-slate-600 underline-offset-4 hover:text-white">
                    Start an organizer account
                  </Link>
                </p>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-800 bg-[#0c1018]">
        <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-16">
          <p className="text-xs font-bold tracking-[0.25em] text-amber-400">HOW GUESTORA WORKS</p>
          <div className="mt-7 grid gap-8 md:grid-cols-3">
            {[
              ["01", "Find an event", "Guests browse published event pages and choose where to apply."],
              ["02", "Get reviewed", "The organizer reviews each application and decides who is approved."],
              ["03", "Show your QR", "Approved guests show their unique QR code to the event team at entry."],
            ].map(([number, title, description]) => (
              <div key={number}>
                <p className="text-sm font-black text-amber-400">{number}</p>
                <h3 className="mt-3 text-xl font-bold">{title}</h3>
                <p className="mt-2 leading-7 text-slate-400">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

    </main>
  );
}
