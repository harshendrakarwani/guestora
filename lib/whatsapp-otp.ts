import "server-only";

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export function normalizeWhatsAppDigits(value: string): string | null {
  const digits = value.trim().replace(/\D/g, "");
  const normalized = !value.trim().startsWith("+") && digits.length === 10 ? `91${digits}` : digits;
  return normalized.length >= 8 && normalized.length <= 15 ? normalized : null;
}

export function createWhatsAppOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashWhatsAppOtp(otp: string, eventId: string, phone: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Supabase server credentials are missing.");
  return createHmac("sha256", key).update(`${eventId}:${phone}:${otp}`).digest("hex");
}

export function verifyWhatsAppOtpHash(otp: string, eventId: string, phone: string, expected: string): boolean {
  const actual = Buffer.from(hashWhatsAppOtp(otp, eventId, phone), "hex");
  const saved = Buffer.from(expected, "hex");
  return actual.length === saved.length && timingSafeEqual(actual, saved);
}

export function hashWhatsAppOtpIp(ip: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Supabase server credentials are missing.");
  return createHmac("sha256", key).update(`whatsapp-otp-ip:${ip}`).digest("hex");
}
