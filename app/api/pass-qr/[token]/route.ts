import QRCode from "qrcode";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ token: string }>;
};

export async function GET(_request: Request, { params }: RouteProps) {
  const { token } = await params;
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(token)) return new Response("Not found", { status: 404 });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return new Response("Pass image unavailable", { status: 503 });
  }

  const { data: application, error } = await admin
    .from("guest_applications")
    .select("id")
    .eq("check_in_token", token)
    .eq("status", "approved")
    .maybeSingle();

  if (error) return new Response("Pass image unavailable", { status: 503 });
  if (!application) return new Response("Not found", { status: 404 });

  const png = await QRCode.toBuffer(token, {
    type: "png",
    width: 512,
    margin: 4,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
