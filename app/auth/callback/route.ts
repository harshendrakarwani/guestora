import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { addAccountRolePatch, hasAccountRole, type AccountRole } from "@/lib/account-roles";

function safeNextPath(value: string | null, audience: string) {
  if (audience === "guest" && value && (/^\/events\/[a-zA-Z0-9-]+$/.test(value) || value === "/dashboard")) return value;
  if (audience === "organizer" && (value === "/organizer" || value === "/organizer/commission/admin")) return value;
  return audience === "organizer" ? "/organizer" : "/dashboard";
}

function redirectAndClearWorkspaceCookies(url: URL) {
  const response = NextResponse.redirect(url);
  response.cookies.delete("guestora_auth_audience");
  response.cookies.delete("guestora_auth_next");
  return response;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const cookieStore = await cookies();
  const requestedAudience = requestUrl.searchParams.get("audience") ?? cookieStore.get("guestora_auth_audience")?.value;
  const audience: AccountRole = requestedAudience === "organizer" ? "organizer" : "guest";
  const requestedNext = requestUrl.searchParams.get("next") ?? cookieStore.get("guestora_auth_next")?.value ?? null;
  const next = safeNextPath(requestedNext, audience);
  const code = requestUrl.searchParams.get("code");

  if (code) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          },
        },
      },
    );
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (!hasAccountRole(data.user.user_metadata, audience)) {
        const { error: roleError } = await supabase.auth.updateUser({
          data: addAccountRolePatch(data.user.user_metadata, audience),
        });
        if (roleError) {
          await supabase.auth.signOut();
          const signInPath = audience === "organizer" ? "/organizer/login" : "/login";
          return redirectAndClearWorkspaceCookies(new URL(`${signInPath}?error=social_auth`, requestUrl.origin));
        }
      }
      return redirectAndClearWorkspaceCookies(new URL(next, requestUrl.origin));
    }
  }

  const signInPath = next === "/organizer/commission/admin" ? "/admin/sign-in" : audience === "organizer" ? "/organizer/login" : "/login";
  return redirectAndClearWorkspaceCookies(new URL(`${signInPath}?error=social_auth`, requestUrl.origin));
}
