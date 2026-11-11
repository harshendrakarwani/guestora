"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { hasAccountRole } from "@/lib/account-roles";
import SiteHeader from "@/components/site-header";
import { APPLICATION_FEE_PAISE } from "@/lib/payment-pricing";

type EventData = {
  id: string;
  title: string;
  venue_name: string | null;
  city: string | null;
  state: string | null;
  description: string | null;
  capacity: number | null;
  status: string;
  application_opens_at: string | null;
  application_closes_at: string | null;
  application_link_closes_at: string | null;
  entry_starts_at: string | null;
  entry_deadline: string | null;
};

type PendingPayment = {
  intentId: string;
  paymentAccessToken: string | null;
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  name: string;
  description: string;
  guestMode: boolean;
};

type RazorpayResult = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: { name?: string; email?: string; contact?: string };
  handler: (result: RazorpayResult) => void | Promise<void>;
  modal?: { ondismiss?: () => void };
  theme?: { color: string };
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

let razorpayCheckoutPromise: Promise<void> | null = null;

function loadRazorpayCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (razorpayCheckoutPromise) return razorpayCheckoutPromise;
  razorpayCheckoutPromise = new Promise<void>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (script?.dataset.loaded === "true") {
      resolve();
      return;
    }
    if (!script) {
      script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      document.body.appendChild(script);
    }
    const timeout = window.setTimeout(() => reject(new Error("Razorpay Checkout took too long to load.")), 15_000);
    script.addEventListener("load", () => {
      window.clearTimeout(timeout);
      script!.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => {
      window.clearTimeout(timeout);
      script!.remove();
      reject(new Error("Could not load Razorpay Checkout."));
    }, { once: true });
  }).catch((error: unknown) => {
    razorpayCheckoutPromise = null;
    throw error;
  });
  return razorpayCheckoutPromise;
}

function normalizeWhatsAppNumber(value: string): string | null {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (!digits) return null;

  const internationalDigits = trimmed.startsWith("+")
    ? digits
    : digits.length === 10
      ? `91${digits}`
      : "";

  if (internationalDigits.length < 8 || internationalDigits.length > 15) {
    return null;
  }

  return `+${internationalDigits}`;
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const details =
      "details" in error && error.details ? String(error.details) : "";
    const code =
      "code" in error && error.code ? `Code: ${String(error.code)}` : "";

    return [String(error.message), details, code]
      .filter(Boolean)
      .join(" — ");
  }

  return error instanceof Error
    ? error.message
    : "Unable to save your application.";
}

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  return /load failed|failed to fetch|networkerror|network request failed|fetch failed/i.test(message);
}

function readPendingPayment(eventId: string | undefined): PendingPayment | null {
  if (typeof window === "undefined" || !eventId) return null;

  try {
    const saved = sessionStorage.getItem(`guestora:pending-application:${eventId}`);
    if (!saved) return null;
    const pending = JSON.parse(saved) as PendingPayment;
    return pending.intentId && pending.orderId && [2000, APPLICATION_FEE_PAISE].includes(pending.amount) && pending.currency === "INR"
      ? pending
      : null;
  } catch {
    return null;
  }
}

export default function PublicEventPage() {
  const params = useParams<{ id: string }>();
  const supabase = useMemo(() => createClient(), []);

  const [event, setEvent] = useState<EventData | null>(null);
  const [approvedCount, setApprovedCount] = useState<number | null | undefined>(undefined);
  const [approvedCapacity, setApprovedCapacity] = useState(200);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedMessage, setSubmittedMessage] = useState("");
  const [duplicateEmailSubmitted, setDuplicateEmailSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [accountMode, setAccountMode] = useState(false);
  const [guestMode, setGuestMode] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [instagramUsername, setInstagramUsername] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [whatsappOtp, setWhatsappOtp] = useState("");
  const [otpSentTo, setOtpSentTo] = useState("");
  const [verifiedWhatsAppNumber, setVerifiedWhatsAppNumber] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpSlowHint, setOtpSlowHint] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpMessage, setOtpMessage] = useState("");
  const [otpError, setOtpError] = useState("");
  const [dashboardLinkOpen, setDashboardLinkOpen] = useState(false);
  const [dashboardLinkEmail, setDashboardLinkEmail] = useState("");
  const [dashboardLinkStatus, setDashboardLinkStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [dashboardLinkError, setDashboardLinkError] = useState("");
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [paymentNotice, setPaymentNotice] = useState("");
  const paymentStatusCheckInFlight = useRef(false);
  const refreshPaymentStatusRef = useRef<() => Promise<boolean>>(async () => false);
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedPayment = readPendingPayment(params.id);
      if (!savedPayment) return;
      setPendingPayment(savedPayment);
      setPaymentNotice("We found your existing checkout. Refresh its status before trying to pay again.");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [params.id]);

  function updatePendingPayment(payment: PendingPayment | null) {
    setPendingPayment(payment);
    if (!params.id) return;
    const storageKey = `guestora:pending-application:${params.id}`;
    if (payment) sessionStorage.setItem(storageKey, JSON.stringify(payment));
    else sessionStorage.removeItem(storageKey);
  }

  function openDashboardLinkDialog() {
    setDashboardLinkEmail(guestEmail.trim());
    setDashboardLinkError("");
    setDashboardLinkStatus("idle");
    setDashboardLinkOpen(true);
  }

  async function sendGuestDashboardLink(email: string) {
    const targetEmail = email.trim();
    setDashboardLinkEmail(targetEmail);
    setDashboardLinkError("");
    setDashboardLinkStatus("sending");
    setDashboardLinkOpen(true);
    try {
      const response = await fetch("/api/guest/dashboard/access-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not send your dashboard link.");
      setDashboardLinkStatus("sent");
    } catch (caught) {
      setDashboardLinkError(caught instanceof Error ? caught.message : "Could not send your dashboard link.");
      setDashboardLinkStatus("error");
    }
  }

  async function sendWhatsAppOtp() {
    const normalizedPhone = normalizeWhatsAppNumber(whatsappNumber);
    if (!normalizedPhone) {
      setOtpError("Enter a valid WhatsApp number first.");
      setOtpMessage("");
      return;
    }
    setOtpSending(true);
    setOtpSlowHint(false);
    setOtpError("");
    setOtpMessage("");
    const waitHintTimer = window.setTimeout(() => setOtpSlowHint(true), 3500);
    try {
      const response = await fetch("/api/whatsapp/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: params.id, phone: normalizedPhone }),
      });
      const result = await response.json().catch(() => ({})) as { sent?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error || "Could not send a WhatsApp code.");
      setOtpSentTo(normalizedPhone);
      setVerifiedWhatsAppNumber("");
      setWhatsappOtp("");
      setOtpMessage(`Verification code sent to ${normalizedPhone}. It expires in 5 minutes.`);
    } catch (caught) {
      setOtpError(isNetworkFailure(caught)
        ? "Connection interrupted while requesting the code. Check your mobile internet. If a code arrived, enter it; otherwise wait one minute before requesting another."
        : caught instanceof Error ? caught.message : "Could not send a WhatsApp code.");
    } finally {
      window.clearTimeout(waitHintTimer);
      setOtpSlowHint(false);
      setOtpSending(false);
    }
  }

  async function verifyWhatsAppOtp() {
    const normalizedPhone = normalizeWhatsAppNumber(whatsappNumber);
    if (!normalizedPhone || normalizedPhone !== otpSentTo) {
      setOtpError("Send a code to the current WhatsApp number first.");
      setOtpMessage("");
      return;
    }
    setOtpVerifying(true);
    setOtpError("");
    setOtpMessage("");
    try {
      const response = await fetch("/api/whatsapp/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: params.id, phone: normalizedPhone, code: whatsappOtp }),
      });
      const result = await response.json().catch(() => ({})) as { verified?: boolean; error?: string };
      if (!response.ok || !result.verified) throw new Error(result.error || "Could not verify that code.");
      setVerifiedWhatsAppNumber(normalizedPhone);
      setOtpMessage("WhatsApp number verified. If your application is approved, your Guestora pass QR will be sent to this number.");
      void loadRazorpayCheckout().catch(() => undefined);
    } catch (caught) {
      setOtpError(isNetworkFailure(caught)
        ? "Could not reach Guestora to verify the code. Check your connection and try again; the current code remains valid until it expires."
        : caught instanceof Error ? caught.message : "Could not verify that code.");
    } finally {
      setOtpVerifying(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadEvent() {
      let data: EventData | null = null;
      let eventError = "";
      try {
        const response = await fetch(`/api/events/${encodeURIComponent(params.id)}`, { cache: "no-store" });
        const result = await response.json().catch(() => ({})) as { event?: EventData; error?: string };
        if (!response.ok) eventError = result.error || "Could not load this event.";
        else data = result.event ?? null;
      } catch {
        eventError = "Could not connect to load this event. Check your connection and try again.";
      }

      if (!active) return;

      const { data: authData } = await supabase.auth.getSession();
      if (!active) return;
      const user = authData.session?.user;
      const guestAccount = Boolean(user && hasAccountRole(user.user_metadata, "guest"));
      setSignedIn(guestAccount);
      if (guestAccount && user) {
        const metadata = user.user_metadata ?? {};
        setGuestName(String(metadata.full_name ?? metadata.name ?? ""));
        setGuestEmail(user.email ?? "");
        setInstagramUsername(String(metadata.instagram_username ?? "").replace(/^@/, ""));
      }
      setCheckingSession(false);

      if (user && guestAccount) {
        const { data: existingApplication } = await supabase
          .from("guest_applications")
          .select("id")
          .eq("event_id", params.id)
          .eq("guest_id", user.id)
          .eq("payment_status", "paid")
          .maybeSingle();
        if (!active) return;
        if (existingApplication) {
          setSubmitted(true);
          setSubmittedMessage("Your application is already submitted. Go to your dashboard to check approval status.");
          setPendingPayment(null);
        }
      }

      if (eventError) {
        setError(eventError);
      } else if (!data) {
        setError("This event was not found or is not published.");
      } else {
        setEvent(data as EventData);
      }

      setLoading(false);
    }

    if (params.id) {
      loadEvent();
    }

    return () => {
      active = false;
    };
  }, [params.id, supabase]);

  useEffect(() => {
    if (!params.id) return;
    let active = true;

    async function refreshEventSchedule() {
      const response = await fetch(`/api/events/${encodeURIComponent(params.id)}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({})) as { event?: EventData };
      const data = response.ok ? result.event : null;

      if (!active || !data) return;
      setEvent((current) => current ? { ...current, ...data } : current);
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") void refreshEventSchedule();
    }

    const interval = window.setInterval(() => void refreshEventSchedule(), 60_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [params.id, supabase]);

  useEffect(() => {
    const eventId = event?.id ?? "";
    if (!eventId) return;
    let active = true;

    async function refreshApprovedCount() {
      try {
        const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/approved-count`, { cache: "no-store" });
        const result = await response.json().catch(() => ({})) as { approvedCount?: number; capacity?: number };
        if (!active) return;
        if (!response.ok || typeof result.approvedCount !== "number") {
          setApprovedCount(null);
          return;
        }
        setApprovedCount(result.approvedCount);
        if (typeof result.capacity === "number" && result.capacity > 0) setApprovedCapacity(result.capacity);
      } catch {
        if (active) setApprovedCount(null);
      }
    }

    void refreshApprovedCount();
    const interval = window.setInterval(() => void refreshApprovedCount(), 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [event?.id]);

  async function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const registrationClosesAt = event?.application_link_closes_at ?? event?.application_closes_at;
    if (registrationClosesAt && new Date(registrationClosesAt).getTime() <= Date.now()) {
      setCurrentTime(Date.now());
      setSubmitError("Event guestlist registrations have now been closed.");
      return;
    }
    setSubmitting(true);
    setSubmitError("");

    const savedWhatsAppNumber = normalizeWhatsAppNumber(whatsappNumber);

    if (!savedWhatsAppNumber) {
      setSubmitError(
        "Enter a valid WhatsApp number. Use 10 digits for an Indian number, or include + and your country code."
      );
      setSubmitting(false);
      return;
    }
    if (verifiedWhatsAppNumber !== savedWhatsAppNumber) {
      setSubmitError("Verify your WhatsApp number before continuing.");
      setSubmitting(false);
      return;
    }
    const normalizedInstagram = instagramUsername.trim().replace(/^@/, "");
    if (normalizedInstagram && !/^[A-Za-z0-9._]{1,30}$/.test(normalizedInstagram)) {
      setSubmitError("Enter a valid Instagram username or leave it blank.");
      setSubmitting(false);
      return;
    }

    try {
      if (!event) {
        setSubmitError("The event could not be loaded. Please refresh.");
        return;
      }

      if (guestMode) {
        if (guestName.trim().length < 2) {
          setSubmitError("Enter your full name.");
          return;
        }
        if (!guestEmail.trim()) {
          setSubmitError("Enter your email address.");
          return;
        }
      }

      const headers = new Headers({ "Content-Type": "application/json" });
      if (!guestMode) {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) {
          setAccountMode(false);
          setSubmitError("Sign in again or choose to continue as a guest.");
          return;
        }
        headers.set("Authorization", `Bearer ${accessToken}`);
      }

      const response = await fetch("/api/payments/order", {
        method: "POST",
        headers,
        body: JSON.stringify({
          eventId: event.id,
          guestMode,
          guestName: guestMode ? guestName.trim() : undefined,
          guestEmail: guestMode ? guestEmail.trim() : undefined,
          instagramUsername: normalizedInstagram,
          guestPhone: savedWhatsAppNumber,
        }),
      });
      const order = await response.json().catch(() => ({})) as Omit<PendingPayment, "guestMode"> & {
        error?: string;
        alreadySubmitted?: boolean;
        message?: string;
        applicationId?: string;
      };
      if (order.alreadySubmitted) {
        setSubmittedMessage(order.message || "An application has already been submitted using this email.");
        setDuplicateEmailSubmitted(true);
        setSubmitted(true);
        setSubmitError("");
        updatePendingPayment(null);
        return;
      }
      if (!response.ok) throw new Error(order.error || "Could not prepare the application payment.");
      const checkout: PendingPayment = { ...order, guestMode };
      updatePendingPayment(checkout);
      setPaymentNotice(`Your details are held securely for checkout. The application is submitted only after the ₹${APPLICATION_FEE_PAISE / 100} payment is confirmed.`);
      setPaymentError("");
      await openCheckout(checkout);
    } catch (err) {
      setSubmitError(isNetworkFailure(err)
        ? "Connection interrupted while preparing checkout. Check your internet and try again. If Razorpay opened or you may have paid, use Refresh payment status before starting another checkout."
        : getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function openCheckout(checkout: PendingPayment) {
    setPaymentBusy(true);
    setPaymentError("");
    try {
      await loadRazorpayCheckout();
      if (!window.Razorpay) throw new Error("Razorpay Checkout did not initialize.");
      const session = checkout.guestMode ? null : (await supabase.auth.getSession()).data.session;
      if (!checkout.guestMode && !session?.access_token) throw new Error("Sign in again to continue payment.");
      const instance = new window.Razorpay({
        key: checkout.keyId,
        amount: checkout.amount,
        currency: checkout.currency,
        name: checkout.name,
        description: checkout.description,
        order_id: checkout.orderId,
        prefill: {
          name: checkout.guestMode ? guestName.trim() : undefined,
          email: checkout.guestMode ? guestEmail.trim() : session?.user.email,
          contact: whatsappNumber.trim(),
        },
        theme: { color: "#fbbf24" },
        handler: async (paymentResult) => {
          setPaymentBusy(true);
          try {
            const verifyHeaders = new Headers({ "Content-Type": "application/json" });
            const currentSession = checkout.guestMode ? null : (await supabase.auth.getSession()).data.session;
            if (currentSession?.access_token) verifyHeaders.set("Authorization", `Bearer ${currentSession.access_token}`);
            const verifyResponse = await fetch("/api/payments/verify", {
              method: "POST",
              headers: verifyHeaders,
              body: JSON.stringify({
                intentId: checkout.intentId,
                paymentAccessToken: checkout.paymentAccessToken,
                ...paymentResult,
              }),
            });
            const verification = await verifyResponse.json().catch(() => ({})) as { paid?: boolean; message?: string; error?: string };
            if (!verifyResponse.ok) throw new Error(verification.error || "Could not verify payment.");
            setPaymentNotice(verification.message || "Payment status updated.");
            if (verification.paid) {
              setSubmittedMessage("Your application is already submitted. Go to your dashboard to check approval status.");
              setSubmitted(true);
              if (checkout.guestMode) void sendGuestDashboardLink(guestEmail.trim());
              updatePendingPayment(null);
            }
          } catch (caught) {
            setPaymentError(isNetworkFailure(caught)
              ? "Connection interrupted while confirming payment. Your payment may have gone through. Tap Refresh payment status before trying to pay again."
              : caught instanceof Error ? caught.message : "Could not verify payment.");
          } finally {
            setPaymentBusy(false);
          }
        },
        modal: { ondismiss: () => setPaymentBusy(false) },
      });
      instance.open();
    } catch (caught) {
      setPaymentError(isNetworkFailure(caught)
        ? "Could not load Razorpay Checkout. Check your internet and try again; no payment was taken."
        : caught instanceof Error ? caught.message : "Could not open Razorpay Checkout.");
      setPaymentBusy(false);
    }
  }

  async function retryPayment() {
    if (!pendingPayment) return;
    const checkout = pendingPayment;
    const canContinue = await refreshPaymentStatus();
    if (canContinue) await openCheckout(checkout);
  }

  async function refreshPaymentStatus(): Promise<boolean> {
    if (!pendingPayment || paymentStatusCheckInFlight.current) return false;
    paymentStatusCheckInFlight.current = true;
    setPaymentBusy(true);
    setPaymentError("");
    try {
      const headers = new Headers({ "Content-Type": "application/json" });
      if (!pendingPayment.guestMode) {
        const session = (await supabase.auth.getSession()).data.session;
        if (!session?.access_token) throw new Error("Sign in again to check payment.");
        headers.set("Authorization", `Bearer ${session.access_token}`);
      }
      const response = await fetch("/api/payments/status", {
        method: "POST",
        headers,
        body: JSON.stringify({ intentId: pendingPayment.intentId, paymentAccessToken: pendingPayment.paymentAccessToken }),
      });
      const result = await response.json().catch(() => ({})) as {
        paymentStatus?: string;
        applicationId?: string | null;
        alreadySubmitted?: boolean;
        canContinue?: boolean;
        message?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "Could not refresh payment status.");
      if (result.alreadySubmitted || result.paymentStatus === "paid") {
        setSubmittedMessage(result.message || "Your application is already submitted. Go to your dashboard to check approval status.");
        setSubmitted(true);
        if (pendingPayment.guestMode) void sendGuestDashboardLink(guestEmail.trim());
        updatePendingPayment(null);
        return false;
      } else {
        setPaymentNotice(result.message || `Payment status: ${result.paymentStatus || "pending"}. Check this status before another payment.`);
        return result.canContinue !== false;
      }
    } catch (caught) {
      setPaymentError(isNetworkFailure(caught)
        ? "Could not reach Guestora to check payment status. Check your connection and refresh again; do not pay again until the status is checked."
        : caught instanceof Error ? caught.message : "Could not refresh payment status.");
      return false;
    } finally {
      paymentStatusCheckInFlight.current = false;
      setPaymentBusy(false);
    }
  }

  refreshPaymentStatusRef.current = refreshPaymentStatus;

  useEffect(() => {
    if (!pendingPayment) return;
    let wasHidden = document.visibilityState === "hidden";
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        wasHidden = true;
      } else if (wasHidden) {
        wasHidden = false;
        window.setTimeout(() => void refreshPaymentStatusRef.current(), 500);
      }
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.setTimeout(() => void refreshPaymentStatusRef.current(), 500);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [pendingPayment?.intentId]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#080b12] p-10 text-white">
        Loading event...
      </main>
    );
  }

  if (error || !event) {
    return (
      <main className="min-h-screen bg-[#080b12] p-10 text-white">
        <h1 className="text-3xl font-bold">Event unavailable</h1>
        <p className="mt-3 text-slate-400">{error || "Event not found."}</p>
        <Link className="mt-6 inline-block text-amber-400" href="/">
          Back to Guestora
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#080b12] text-white">
      <SiteHeader current="events" />
      <div className="mx-auto max-w-3xl px-5 py-12">

        <section className="mt-10 rounded-3xl border border-slate-800 bg-[#11151e] p-7 sm:p-10">
          <p className="text-sm font-bold uppercase tracking-[0.25em] text-amber-400">
            Guest list
          </p>

          <h1 className="mt-4 text-4xl font-black sm:text-5xl">
            {event.title}
          </h1>

          <p className="mt-4 text-slate-300">
            {event.venue_name || "Venue to be announced"}
            {event.city ? ` · ${event.city}` : ""}
            {event.state ? ` · ${event.state}` : ""}
          </p>

          {event.description?.trim() && event.description.trim() !== String(event.capacity ?? 200) && (
            <p className="mt-6 whitespace-pre-wrap leading-7 text-slate-300">
              {event.description}
            </p>
          )}

          <div className="mt-8 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-5">
            <p className="text-sm text-slate-400">Approved applicants</p>
            <p className="mt-1 text-3xl font-black tracking-tight text-amber-300">
              {approvedCount === undefined ? "Loading approval count…" : approvedCount === null ? "Approval count unavailable" : `${approvedCount}/${approvedCapacity} approved`}
            </p>
            {typeof approvedCount === "number" && (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-label="Approved guest capacity" aria-valuemin={0} aria-valuemax={approvedCapacity} aria-valuenow={Math.min(approvedCount, approvedCapacity)}>
                <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.min(100, (approvedCount / approvedCapacity) * 100)}%` }} />
              </div>
            )}
          </div>

          <div className="mt-5 grid gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-300 sm:grid-cols-2">
            <p>Guest list registration starts at: <span className="font-semibold text-white">{event.application_opens_at ? new Date(event.application_opens_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Not set"}</span></p>
            <p>Guest list registration closes at: <span className="font-semibold text-white">{(event.application_link_closes_at ?? event.application_closes_at) ? new Date((event.application_link_closes_at ?? event.application_closes_at)!).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Not set"}</span></p>
            <p>Guest list entry starts at: <span className="font-semibold text-white">{event.entry_starts_at ? new Date(event.entry_starts_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Not set"}</span></p>
            <p>Guest list entry closes at: <span className="font-semibold text-white">{event.entry_deadline ? new Date(event.entry_deadline).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Not set"}</span></p>
          </div>

          <div className="mt-8">
            {!submitted && !pendingPayment && (event.application_link_closes_at ?? event.application_closes_at) && new Date((event.application_link_closes_at ?? event.application_closes_at)!).getTime() <= currentTime ? (
              <p role="status" className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-5 text-center text-lg font-bold text-amber-200">
                Event guestlist registrations have now been closed.
              </p>
            ) : !submitted && !pendingPayment && event.application_opens_at && new Date(event.application_opens_at).getTime() > currentTime ? (
              <p role="status" className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-5 text-center text-lg font-bold text-amber-200">
                Guest list registration opens at {new Date(event.application_opens_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}.
              </p>
            ) : submitted ? (
              <div role="status" className="rounded-xl border border-green-800 bg-green-950 p-5 text-center text-green-300">
                <p>{submittedMessage}</p>
                {duplicateEmailSubmitted && <p className="mt-2 text-sm text-green-200/90">Sign in to Guestora to track your application.</p>}
                <Link href={duplicateEmailSubmitted && !signedIn ? `/login?next=${encodeURIComponent("/dashboard")}` : "/dashboard"} className="mt-4 inline-flex rounded-xl bg-amber-400 px-5 py-3 font-bold text-black hover:bg-amber-300">
                  {duplicateEmailSubmitted && !signedIn ? "Sign in to track application" : duplicateEmailSubmitted ? "Track application" : "Go to dashboard"}
                </Link>
                {!duplicateEmailSubmitted && <p className="mt-4 text-sm text-green-200/80">
                  Applied as a guest? <button type="button" onClick={openDashboardLinkDialog} className="font-semibold underline underline-offset-4">Get your dashboard link by email</button>.
                </p>}
              </div>
            ) : pendingPayment ? (
              <div className="rounded-2xl border border-amber-500/30 bg-[#080b12] p-5 text-center">
                <h2 className="text-xl font-bold">Complete your application</h2>
                <p className="mt-2 text-sm text-slate-300">Pay ₹{pendingPayment.amount / 100} securely with Razorpay. Your application is submitted for organizer review only after payment is confirmed.</p>
                {paymentNotice && <p role="status" className="mt-4 text-sm text-amber-200">{paymentNotice}</p>}
                {paymentError && <p role="alert" className="mt-4 text-sm text-red-300">{paymentError}</p>}
                <button type="button" onClick={() => void retryPayment()} disabled={paymentBusy} className="mt-5 w-full rounded-xl bg-amber-400 px-5 py-4 font-bold text-black disabled:opacity-60">
                  {paymentBusy ? "Opening secure checkout..." : `Pay ₹${pendingPayment.amount / 100} with Razorpay`}
                </button>
                <button type="button" onClick={() => void refreshPaymentStatus()} disabled={paymentBusy} className="mt-3 w-full rounded-xl border border-slate-700 px-5 py-3 font-semibold text-slate-300 hover:border-slate-500 disabled:opacity-60">
                  Refresh payment status
                </button>
                <p className="mt-4 text-xs text-slate-500">If you already paid, refresh the status before doing anything else. Guestora will reuse your active checkout and block another payment after submission.</p>
              </div>
            ) : checkingSession ? (
              <p className="rounded-xl border border-slate-800 bg-[#080b12] p-4 text-center text-slate-400">Loading application options...</p>
            ) : !accountMode && !guestMode ? (
              <div className="rounded-2xl border border-slate-800 bg-[#080b12] p-5">
                <p className="text-center text-slate-300">Choose how you want to apply.</p>
                {signedIn ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setAccountMode(true)}
                      className="rounded-xl border border-slate-700 px-5 py-3 text-center font-bold hover:border-amber-400"
                    >
                      Apply with my account
                    </button>
                    <button
                      type="button"
                      onClick={() => setGuestMode(true)}
                      className="rounded-xl bg-amber-400 px-5 py-3 font-bold text-black hover:bg-amber-300"
                    >
                      Continue as guest
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const { error } = await supabase.auth.signOut();
                        if (error) {
                          setSubmitError(error.message);
                          return;
                        }
                        setSignedIn(false);
                        setSubmitError("");
                      }}
                      className="sm:col-span-2 rounded-xl border border-slate-700 px-5 py-3 text-center font-semibold text-slate-300 hover:border-slate-500"
                    >
                      Sign in or create another account
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <Link
                      href={`/login?next=${encodeURIComponent(`/events/${event.id}`)}`}
                      className="rounded-xl border border-slate-700 px-5 py-3 text-center font-bold hover:border-amber-400"
                    >
                      Sign in
                    </Link>
                    <Link
                      href={`/signup?next=${encodeURIComponent(`/events/${event.id}`)}`}
                      className="rounded-xl border border-slate-700 px-5 py-3 text-center font-bold hover:border-amber-400"
                    >
                      Sign up
                    </Link>
                    <button
                      type="button"
                      onClick={() => setGuestMode(true)}
                      className="rounded-xl bg-amber-400 px-5 py-3 font-bold text-black hover:bg-amber-300"
                    >
                      Continue as guest
                    </button>
                  </div>
                )}
                {submitError && <p role="alert" className="mt-3 text-center text-sm text-red-400">{submitError}</p>}
                <p className="mt-3 text-center text-xs text-slate-500">You can apply without creating an account.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                {signedIn && accountMode && !guestMode && (
                  <p className="mb-4 text-sm text-slate-300">Applying with your Guestora account.</p>
                )}
                {guestMode && (
                  <>
                    <p className="mb-4 text-sm text-slate-300">Apply as a guest. We’ll use your email and WhatsApp number for application updates.</p>
                    <label htmlFor="guest-name" className="mb-2 block text-sm font-semibold">Full name</label>
                    <input
                      id="guest-name"
                      type="text"
                      autoComplete="name"
                      maxLength={120}
                      required
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      placeholder="Your full name"
                      className="mb-4 w-full rounded-xl border border-slate-700 bg-[#080b12] px-4 py-3 text-white outline-none focus:border-amber-400"
                    />
                    <label htmlFor="guest-email" className="mb-2 block text-sm font-semibold">Email address</label>
                    <input
                      id="guest-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="mb-4 w-full rounded-xl border border-slate-700 bg-[#080b12] px-4 py-3 text-white outline-none focus:border-amber-400"
                    />
                  </>
                )}
                <label htmlFor="instagram-username" className="mb-2 block text-sm font-semibold">Instagram username <span className="font-normal text-slate-500">(optional)</span></label>
                <div className="mb-5 flex min-h-12 items-center rounded-xl border border-slate-700 bg-[#080b12] px-4 focus-within:border-amber-400">
                  <span className="text-slate-500">@</span>
                  <input id="instagram-username" type="text" autoComplete="off" maxLength={30} value={instagramUsername} onChange={(e) => setInstagramUsername(e.target.value.replace(/^@/, ""))} placeholder="yourusername" className="min-w-0 flex-1 bg-transparent px-2 py-3 text-white outline-none" />
                </div>
                <p className="mb-4 text-sm text-slate-300">
                  Verify your WhatsApp number first. Different applicants can share a number, but each needs a different email. Passes for this number will arrive in the same WhatsApp chat.
                </p>

                <label
                  htmlFor="whatsapp-number"
                  className="mb-2 block text-sm font-semibold"
                >
                  WhatsApp number
                </label>
                <input
                  id="whatsapp-number"
                  type="tel"
                  autoComplete="tel"
                  required
                  value={whatsappNumber}
                  onChange={(e) => {
                    setWhatsappNumber(e.target.value);
                    setOtpSentTo("");
                    setVerifiedWhatsAppNumber("");
                    setWhatsappOtp("");
                    setOtpMessage("");
                    setOtpError("");
                  }}
                  placeholder="+91 98765 43210"
                  className="mb-4 w-full rounded-xl border border-slate-700 bg-[#080b12] px-4 py-3 text-white outline-none focus:border-amber-400"
                />

                <p className="-mt-2 mb-4 text-xs text-slate-500">
                  Indian numbers can be entered as 10 digits. Other numbers
                  should include + and the country code.
                </p>

                {verifiedWhatsAppNumber === normalizeWhatsAppNumber(whatsappNumber) ? (
                  <p role="status" className="mb-4 rounded-xl border border-emerald-700/60 bg-emerald-950/30 p-3 text-sm text-emerald-300">✓ WhatsApp number verified. Your pass QR will be sent here if approved.</p>
                ) : (
                  <div className="mb-5 rounded-xl border border-slate-800 bg-[#0b0e15] p-4">
                    <button type="button" onClick={() => void sendWhatsAppOtp()} disabled={otpSending || otpVerifying} className="rounded-lg border border-amber-500/50 px-4 py-2 text-sm font-bold text-amber-300 hover:border-amber-300 disabled:opacity-50">
                      {otpSending ? "Sending code…" : otpSentTo === normalizeWhatsAppNumber(whatsappNumber) ? "Resend WhatsApp code" : "Send WhatsApp code"}
                    </button>
                    {otpSending && <p role="status" aria-live="polite" className="mt-3 text-sm text-amber-200">{otpSlowHint ? "Still waiting for WhatsApp to confirm delivery. Keep this page open; this usually takes a few seconds." : `Requesting a code for ${normalizeWhatsAppNumber(whatsappNumber)}…`}</p>}
                    {otpSentTo === normalizeWhatsAppNumber(whatsappNumber) && (
                      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                        <input aria-label="WhatsApp verification code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={whatsappOtp} onChange={(e) => setWhatsappOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit code" className="w-full rounded-lg border border-slate-700 bg-[#080b12] px-4 py-3 text-white outline-none focus:border-amber-400 sm:max-w-xs" />
                        <button type="button" onClick={() => void verifyWhatsAppOtp()} disabled={otpVerifying || whatsappOtp.length !== 6} className="rounded-lg bg-amber-400 px-4 py-3 text-sm font-bold text-black disabled:opacity-50">
                          {otpVerifying ? "Verifying..." : "Verify number"}
                        </button>
                      </div>
                    )}
                    {otpMessage && <p role="status" className="mt-3 text-sm text-emerald-300">{otpMessage}</p>}
                    {otpError && <p role="alert" className="mt-3 text-sm text-red-400">{otpError}</p>}
                  </div>
                )}

                {submitError && (
                  <p role="alert" className="mb-4 text-sm text-red-400">
                    {submitError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting || verifiedWhatsAppNumber !== normalizeWhatsAppNumber(whatsappNumber)}
                  className="w-full rounded-xl bg-amber-400 px-5 py-4 font-bold text-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? "Preparing secure checkout..." : verifiedWhatsAppNumber !== normalizeWhatsAppNumber(whatsappNumber) ? "Verify WhatsApp to continue" : `Continue to ₹${APPLICATION_FEE_PAISE / 100} payment`}
                </button>

                <button type="button" onClick={() => { setGuestMode(false); setAccountMode(false); setSubmitError(""); }} className="mt-3 w-full rounded-xl border border-slate-700 px-5 py-3 font-semibold text-slate-300 hover:border-slate-500">
                  Back to application options
                </button>

                <p className="mt-3 text-center text-sm text-slate-400">
                  Application fee: ₹{APPLICATION_FEE_PAISE / 100}. If the organizer rejects your application, the fee will be refunded. Organizers may deny entry after the published guest-list entry deadline; late arrival or entry denied after that time is not refundable. Payment is processed securely by Razorpay. <Link href="/support" className="text-amber-300 underline">Support</Link>
                </p>
              </form>
            )}
          </div>
        </section>
      </div>
      {dashboardLinkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-8" onMouseDown={(event) => { if (event.target === event.currentTarget) setDashboardLinkOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="guest-dashboard-link-title" className="w-full max-w-md rounded-3xl border border-slate-700 bg-[#11151e] p-6 text-white shadow-2xl sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-extrabold tracking-[0.22em] text-amber-400">GUEST DASHBOARD</p>
                <h2 id="guest-dashboard-link-title" className="mt-2 text-2xl font-black">Your dashboard link</h2>
              </div>
              <button type="button" aria-label="Close" onClick={() => setDashboardLinkOpen(false)} className="rounded-lg px-3 py-1 text-xl text-slate-400 hover:bg-slate-800 hover:text-white">×</button>
            </div>
            {dashboardLinkStatus === "sending" && <p role="status" aria-live="polite" className="mt-5 rounded-xl border border-amber-700/50 bg-amber-950/30 p-4 text-sm text-amber-100">Sending your Guestora dashboard link to <strong>{dashboardLinkEmail}</strong>…</p>}
            {dashboardLinkStatus === "sent" && <p role="status" className="mt-5 rounded-xl border border-emerald-800 bg-emerald-950/40 p-4 text-sm leading-6 text-emerald-200">Your guest dashboard link has been sent to your email. It won’t expire. Anyone with access to that inbox can use it, and requesting a new link will disable this one.</p>}
            {dashboardLinkStatus === "idle" && <p className="mt-4 text-sm leading-6 text-slate-300">We’ll email a secure link for the guest applications associated with this email address.</p>}
            {dashboardLinkStatus === "error" && <p role="alert" className="mt-5 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">{dashboardLinkError}</p>}
            {(dashboardLinkStatus === "idle" || dashboardLinkStatus === "error") && (
              <form onSubmit={(event) => { event.preventDefault(); void sendGuestDashboardLink(dashboardLinkEmail); }} className="mt-5 space-y-4">
                <label className="block text-sm font-semibold" htmlFor="dashboard-link-email">Email address</label>
                <input id="dashboard-link-email" type="email" inputMode="email" autoComplete="email" required value={dashboardLinkEmail} onChange={(event) => setDashboardLinkEmail(event.target.value)} placeholder="you@example.com" className="w-full rounded-xl border border-slate-700 bg-[#080b12] px-4 py-3 outline-none focus:border-amber-400" />
                <button type="submit" className="w-full rounded-xl bg-amber-400 px-5 py-3 font-bold text-black hover:bg-amber-300">Email me the dashboard link</button>
              </form>
            )}
            {dashboardLinkStatus === "sent" && <button type="button" onClick={() => setDashboardLinkOpen(false)} className="mt-5 w-full rounded-xl bg-amber-400 px-5 py-3 font-bold text-black hover:bg-amber-300">Got it</button>}
            {dashboardLinkStatus === "sending" && <button type="button" onClick={() => setDashboardLinkOpen(false)} className="mt-5 w-full rounded-xl border border-slate-700 px-5 py-3 font-semibold text-slate-300 hover:border-slate-500">Close</button>}
          </section>
        </div>
      )}
    </main>
  );
}
