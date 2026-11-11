import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase-admin";
import { getRazorpayConfig } from "@/lib/razorpay-server";

export const maxDuration = 60;

type ApplicationRow = {
  id: string;
  status: string;
  auto_rejected: boolean;
  payment_status: string;
  application_fee_paise: number;
  razorpay_payment_id: string | null;
};

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret || !authorization.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function refundApplication(
  admin: ReturnType<typeof createAdminClient>,
  application: ApplicationRow,
  razorpay: { keyId: string; keySecret: string } | null,
) {
  if (application.payment_status !== "paid" || !application.razorpay_payment_id || !razorpay) return "not_started" as const;

  // Claim the refund atomically. Manual organizer refunds and repeated cron
  // invocations cannot both send a refund for the same payment.
  const { data: lock, error: lockError } = await admin.from("guest_applications")
    .update({ payment_status: "refund_processing" })
    .eq("id", application.id)
    .eq("status", "rejected")
    .eq("auto_rejected", true)
    .eq("payment_status", "paid")
    .is("razorpay_refund_id", null)
    .select("id")
    .maybeSingle();
  if (lockError) throw new Error(`Could not reserve refund for ${application.id}.`);
  if (!lock) return "already_claimed" as const;

  let response: Response;
  try {
    response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(application.razorpay_payment_id)}/refund`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${razorpay.keyId}:${razorpay.keySecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: application.application_fee_paise, notes: { application_id: application.id, reason: "auto_rejected_after_24_hours" } }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    // The provider may have accepted a timed-out request. Keep the lock for
    // reconciliation, as the manual refund flow does, to prevent duplicates.
    return "reconciliation_required" as const;
  }

  const refund = await response.json().catch(() => ({})) as { id?: string };
  if (!response.ok || !refund.id) return "reconciliation_required" as const;

  const { error: saveError } = await admin.from("guest_applications")
    .update({ payment_status: "refund_pending", razorpay_refund_id: refund.id })
    .eq("id", application.id)
    .eq("payment_status", "refund_processing");
  if (saveError) throw new Error(`Razorpay accepted the refund for ${application.id}, but its reference could not be saved.`);
  return "initiated" as const;
}

async function processWithConcurrency<T>(items: T[], concurrency: number, action: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await action(items[index]);
    }
  });
  await Promise.all(workers);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); }
  catch { return Response.json({ error: "Supabase server credentials are missing." }, { status: 503 }); }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: expired, error: expiredError } = await admin.from("guest_applications")
    .select("id, status, auto_rejected, payment_status, application_fee_paise, razorpay_payment_id")
    .eq("status", "pending")
    .lte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(20);
  if (expiredError) return Response.json({ error: "Could not load expired applications." }, { status: 500 });

  let rejected = 0;
  const newlyRejected: ApplicationRow[] = [];
  for (const row of (expired ?? []) as ApplicationRow[]) {
    const { data, error } = await admin.from("guest_applications")
      .update({ status: "rejected", auto_rejected: true, reviewed_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "pending")
      .lte("created_at", cutoff)
      .select("id, status, auto_rejected, payment_status, application_fee_paise, razorpay_payment_id")
      .maybeSingle();
    if (error) return Response.json({ error: "Could not reject an expired application." }, { status: 500 });
    if (data) {
      rejected += 1;
      newlyRejected.push(data as ApplicationRow);
    }
  }

  // Recover rejected applications that could not start a refund because
  // Razorpay credentials were temporarily unavailable on an earlier run.
  const { data: retryRows, error: retryError } = await admin.from("guest_applications")
    .select("id, status, auto_rejected, payment_status, application_fee_paise, razorpay_payment_id")
    .eq("status", "rejected")
    .eq("auto_rejected", true)
    .eq("payment_status", "paid")
    .not("razorpay_payment_id", "is", null)
    .is("razorpay_refund_id", null)
    .order("reviewed_at", { ascending: true })
    .limit(20);
  if (retryError) return Response.json({ error: "Could not load pending automatic refunds." }, { status: 500 });

  const applications = [...new Map(
    [...newlyRejected, ...((retryRows ?? []) as ApplicationRow[])].map((row) => [row.id, row]),
  ).values()];
  const razorpay = getRazorpayConfig();
  const counts = { refundInitiated: 0, refundNeedsReconciliation: 0, refundNotStarted: 0 };
  try {
    await processWithConcurrency(applications, 8, async (application) => {
      const result = await refundApplication(admin, application, razorpay);
      if (result === "initiated") counts.refundInitiated += 1;
      else if (result === "reconciliation_required") counts.refundNeedsReconciliation += 1;
      else if (result === "not_started") counts.refundNotStarted += 1;
    });
  } catch (error) {
    console.error("Automatic application rejection/refund processing failed", error);
    return Response.json({ error: "Some automatic rejections or refunds need a retry." }, { status: 500 });
  }

  return Response.json({ rejected, ...counts });
}
