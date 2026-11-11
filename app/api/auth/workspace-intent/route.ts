import { NextResponse } from "next/server";

type Audience = "guest" | "organizer";

function safeNextPath(value: unknown, audience: Audience): string {
  if (audience === "organizer") return value === "/organizer/commission/admin" ? value : "/organizer";
  return typeof value === "string" && /^\/events\/[a-zA-Z0-9-]+$/.test(value)
    ? value
    : "/dashboard";
}

export async function POST(request: Request) {
  let body: { audience?: unknown; next?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid sign-in intent." }, { status: 400 });
  }

  const audience: Audience = body.audience === "organizer" ? "organizer" : "guest";
  const next = safeNextPath(body.next, audience);
  const response = NextResponse.json({ ok: true });
  const secure = new URL(request.url).protocol === "https:";
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: 10 * 60,
  };
  response.cookies.set("guestora_auth_audience", audience, cookieOptions);
  response.cookies.set("guestora_auth_next", next, cookieOptions);
  return response;
}

export async function DELETE(request: Request) {
  const response = NextResponse.json({ ok: true });
  const secure = new URL(request.url).protocol === "https:";
  response.cookies.set("guestora_auth_audience", "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("guestora_auth_next", "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
  return response;
}
