import "server-only";

import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export function getRazorpayConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret };
}

export function isValidHmac(value: string, expectedHex: string) {
  if (!/^[a-f0-9]+$/i.test(value) || !/^[a-f0-9]+$/i.test(expectedHex)) return false;
  const left = Buffer.from(value, "hex");
  const right = Buffer.from(expectedHex, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hashPaymentAccessToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function safeHexEqual(leftHex: string, rightHex: string) {
  if (!/^[a-f0-9]+$/i.test(leftHex) || !/^[a-f0-9]+$/i.test(rightHex)) return false;
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function createRazorpayOrder(input: {
  amount: number;
  applicationId: string;
  eventTitle: string;
}) {
  const config = getRazorpayConfig();
  if (!config) throw new Error("Razorpay test keys are not configured on the server.");

  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: input.amount,
      currency: "INR",
      receipt: input.applicationId,
      notes: { application_id: input.applicationId, event_title: input.eventTitle.slice(0, 200) },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const result = await response.json().catch(() => ({})) as {
    id?: string;
    amount?: number;
    currency?: string;
    error?: { description?: string };
  };
  if (!response.ok || !result.id) {
    throw new Error(result.error?.description || "Razorpay could not create a payment order.");
  }
  return { id: result.id, amount: result.amount ?? input.amount, currency: result.currency ?? "INR" };
}

export async function getRazorpayPayment(paymentId: string) {
  const config = getRazorpayConfig();
  if (!config) throw new Error("Razorpay is not configured on the server.");
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const result = await response.json().catch(() => ({})) as {
    id?: string;
    order_id?: string;
    amount?: number;
    currency?: string;
    status?: string;
    captured?: boolean;
    error?: { description?: string };
  };
  if (!response.ok || !result.id) {
    throw new Error(result.error?.description || "Could not confirm this Razorpay payment.");
  }
  return result;
}

export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string) {
  const config = getRazorpayConfig();
  if (!config) return false;
  const expected = createHmac("sha256", config.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return isValidHmac(signature, expected);
}
