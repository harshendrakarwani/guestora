"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SiteHeader from "@/components/site-header";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { hasAccountRole } from "@/lib/account-roles";
import indiaLocations from "@/lib/india-locations.json";

type EventItem = {
  id: string;
  organizer_id: string;
  title: string;
  description: string | null;
  venue_name: string | null;
  city: string | null;
  state: string | null;
  application_opens_at: string | null;
  application_closes_at: string | null;
  application_link_closes_at: string | null;
  entry_starts_at: string | null;
  entry_deadline: string | null;
  entry_closed_at: string | null;
  capacity: number | null;
  status: string;
  listing_fee_status: string;
  created_at: string;
};

type ListingCheckout = { keyId: string; orderId: string; amount: number; currency: string; name: string; description: string };
type ListingCheckoutResult = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type ListingCheckoutOptions = ListingCheckout & { key: string; handler: (result: ListingCheckoutResult) => void | Promise<void>; modal?: { ondismiss?: () => void }; theme?: { color: string } };

type ApplicationItem = {
  id: string;
  event_id: string;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  whatsapp_pass_sent_at: string | null;
  whatsapp_delivery_status?: string | null;
  whatsapp_status_updated_at?: string | null;
  whatsapp_delivery_error?: string | null;
  status: string;
  application_fee_paise: number;
  payment_status: string;
  checked_in_at: string | null;
  created_at: string;
};
type CommissionClaimStatus = { eventId: string; status: string };

const inputClass =
  "mt-2 w-full rounded-xl border border-slate-700 bg-[#0b0e15] px-4 py-3 text-white outline-none transition focus:border-amber-400";

function toLocalDateTimeInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function OrganizerPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [userId, setUserId] = useState("");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [commissionClaimStatuses, setCommissionClaimStatuses] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [closingEntryEventId, setClosingEntryEventId] = useState("");
  const [deletingEventId, setDeletingEventId] = useState("");
  const [reviewingApplicationId, setReviewingApplicationId] = useState("");
  const [checkingInApplicationId, setCheckingInApplicationId] = useState("");
  const [sendingWhatsAppApplicationId, setSendingWhatsAppApplicationId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState("");
  const [siteOrigin, setSiteOrigin] = useState("");
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [copiedEventId, setCopiedEventId] = useState("");

  const [selectedEventId, setSelectedEventId] = useState("");
  const [applications, setApplications] = useState<ApplicationItem[]>([]);
  const [loadingApplications, setLoadingApplications] = useState(false);
  const [editingScheduleEventId, setEditingScheduleEventId] = useState("");
  const [scheduleRegistrationOpensAt, setScheduleRegistrationOpensAt] = useState("");
  const [scheduleRegistrationClosesAt, setScheduleRegistrationClosesAt] = useState("");
  const [scheduleEntryStartsAt, setScheduleEntryStartsAt] = useState("");
  const [scheduleEntryClosesAt, setScheduleEntryClosesAt] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSiteOrigin(window.location.origin);
      setCurrentTimeMs(Date.now());
    }, 0);
    const clock = window.setInterval(() => setCurrentTimeMs(Date.now()), 60_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(clock);
    };
  }, []);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [venueName, setVenueName] = useState("");
  const [stateName, setStateName] = useState("");
  const [city, setCity] = useState("");
  const [customCity, setCustomCity] = useState("");
  const selectedState = indiaLocations.find((state) => state.name === stateName);
  const stateCities = selectedState?.cities ?? [];
  const isCustomCity = city === "__other__";
  const [applicationOpensAt, setApplicationOpensAt] = useState("");
  const [registrationClosesAt, setRegistrationClosesAt] = useState("");
  const [entryStartsAt, setEntryStartsAt] = useState("");
  const [entryClosesAt, setEntryClosesAt] = useState("");
  const [capacity, setCapacity] = useState("200");

  function beginEventEdit(event: EventItem) {
    setEditingEventId(event.id);
    setTitle(event.title);
    setDescription(event.description ?? "");
    setVenueName(event.venue_name ?? "");
    setStateName(event.state ?? "");
    const knownCities = indiaLocations.find((entry) => entry.name === event.state)?.cities ?? [];
    if (event.city && !knownCities.includes(event.city)) { setCity("__other__"); setCustomCity(event.city); }
    else { setCity(event.city ?? ""); setCustomCity(""); }
    setApplicationOpensAt(toLocalDateTimeInput(event.application_opens_at));
    setRegistrationClosesAt(toLocalDateTimeInput(event.application_link_closes_at ?? event.application_closes_at));
    setEntryStartsAt(toLocalDateTimeInput(event.entry_starts_at));
    setEntryClosesAt(toLocalDateTimeInput(event.entry_deadline));
    setCapacity(String(event.capacity ?? 200));
    setShowForm(true);
    setErrorMessage("");
    setSuccessMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function clearEventForm() {
    setEditingEventId(""); setTitle(""); setDescription(""); setVenueName(""); setStateName(""); setCity(""); setCustomCity("");
    setApplicationOpensAt(""); setRegistrationClosesAt(""); setEntryStartsAt(""); setEntryClosesAt(""); setCapacity("200");
    setShowForm(false);
  }

  const loadEvents = useCallback(
    async (id: string) => {
      const { data, error } = await supabase
        .from("events")
        .select(
          "id, organizer_id, title, description, venue_name, city, state, application_opens_at, application_closes_at, application_link_closes_at, entry_starts_at, entry_deadline, entry_closed_at, capacity, status, listing_fee_status, created_at"
        )
        .eq("organizer_id", id)
        .order("created_at", { ascending: false });

      if (error) {
        setErrorMessage(
          `Could not load events: ${error.message} (Code: ${error.code})`
        );
        return;
      }

      setEvents((data ?? []) as EventItem[]);
      setErrorMessage("");
    },
    [supabase]
  );

  const loadApplications = useCallback(
    async (eventId: string) => {
      setSelectedEventId(eventId);
      setLoadingApplications(true);
      setErrorMessage("");
      setSuccessMessage("");

      const { data, error } = await supabase
        .from("guest_applications")
        .select(
          "id, event_id, guest_name, guest_email, guest_phone, status, application_fee_paise, payment_status, checked_in_at, created_at, whatsapp_pass_sent_at, whatsapp_delivery_status, whatsapp_status_updated_at, whatsapp_delivery_error"
        )
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });

      if (error) {
        setApplications([]);
        setErrorMessage(`Could not load applications: ${error.message}`);
      } else {
        setApplications((data ?? []) as ApplicationItem[]);
      }

      setLoadingApplications(false);
    },
    [supabase]
  );

  async function reviewApplication(
    application: ApplicationItem,
    newStatus: "approved" | "rejected"
  ) {
    if (newStatus === "approved" && application.payment_status !== "paid") {
      setErrorMessage("This application cannot be approved until its application fee is paid.");
      return;
    }
    setErrorMessage("");
    setSuccessMessage("");
    setReviewingApplicationId(application.id);

    const { error } = await supabase
      .from("guest_applications")
      .update({
        status: newStatus,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", application.id)
      .eq("event_id", application.event_id);

    setReviewingApplicationId("");

    if (error) {
      setErrorMessage(`Could not update application: ${error.message}`);
      return;
    }

    await loadApplications(application.event_id);

    if (newStatus === "approved") {
      // A re-approved application must receive a fresh pass even if an older
      // delivery timestamp remains from a previous approval attempt.
      await sendWhatsAppPass(application.id, true);
    } else {
      if (application.payment_status === "paid") {
        try {
          const accessToken = (await supabase.auth.getSession()).data.session?.access_token;
          if (!accessToken) throw new Error("Your session expired. Sign in again.");
          const response = await fetch("/api/payments/refund", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ applicationId: application.id }),
          });
          const result = await response.json().catch(() => ({})) as { message?: string; error?: string };
          setSuccessMessage(response.ok
            ? `Application rejected. ${result.message || "Refund requested."}`
            : `Application rejected, but the refund needs attention: ${result.error || "Please check Razorpay Dashboard."}`);
        } catch (caught) {
          setSuccessMessage(`Application rejected, but the refund needs attention: ${caught instanceof Error ? caught.message : "Please check Razorpay Dashboard."}`);
        }
      } else {
        setSuccessMessage("Application rejected. No captured payment was taken, so no refund is due.");
      }
    }
  }

  async function sendWhatsAppPass(applicationId: string, force = false) {
    setErrorMessage("");
    setSuccessMessage("");
    setSendingWhatsAppApplicationId(applicationId);

    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Your session expired. Sign in again.");

      const response = await fetch("/api/whatsapp/send-pass", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ applicationId, force }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error || "WhatsApp could not send the guest pass.");
      }

      if (selectedEventId) await loadApplications(selectedEventId);
      setSuccessMessage(result.message || "Pass sent on WhatsApp.");
    } catch (error) {
      setErrorMessage(
        `The application is approved, but WhatsApp delivery failed: ${error instanceof Error ? error.message : "Please try again."}`
      );
    } finally {
      setSendingWhatsAppApplicationId("");
    }
  }

  async function checkInApplication(application: ApplicationItem) {
    if (application.status !== "approved") {
      setErrorMessage("Only approved applications can be checked in.");
      return;
    }

    if (application.checked_in_at) {
      setErrorMessage("This guest has already been checked in.");
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");
    setCheckingInApplicationId(application.id);

    const checkedInAt = new Date().toISOString();

    const { error } = await supabase
      .from("guest_applications")
      .update({ checked_in_at: checkedInAt })
      .eq("id", application.id)
      .eq("event_id", application.event_id)
      .is("checked_in_at", null);

    setCheckingInApplicationId("");

    if (error) {
      setErrorMessage(`Could not check in guest: ${error.message}`);
      return;
    }

    setSuccessMessage("Guest checked in.");
    await loadApplications(application.event_id);
  }

  function beginScheduleEdit(event: EventItem) {
    setEditingScheduleEventId(event.id);
    setScheduleRegistrationOpensAt(toLocalDateTimeInput(event.application_opens_at));
    setScheduleRegistrationClosesAt(toLocalDateTimeInput(event.application_link_closes_at ?? event.application_closes_at));
    setScheduleEntryStartsAt(toLocalDateTimeInput(event.entry_starts_at));
    setScheduleEntryClosesAt(toLocalDateTimeInput(event.entry_deadline));
    setErrorMessage("");
    setSuccessMessage("");
  }

  async function saveEventSchedule(event: EventItem) {
    setErrorMessage("");
    setSuccessMessage("");

    const registrationOpens = scheduleRegistrationOpensAt ? new Date(scheduleRegistrationOpensAt) : null;
    const registrationCloses = scheduleRegistrationClosesAt ? new Date(scheduleRegistrationClosesAt) : null;
    const entryStarts = scheduleEntryStartsAt ? new Date(scheduleEntryStartsAt) : null;
    const entryCloses = scheduleEntryClosesAt ? new Date(scheduleEntryClosesAt) : null;
    if ([registrationOpens, registrationCloses, entryStarts, entryCloses].some((date) => date && Number.isNaN(date.getTime()))) {
      setErrorMessage("Enter valid dates and times.");
      return;
    }
    if (registrationOpens && registrationCloses && registrationCloses <= registrationOpens) {
      setErrorMessage("Guest list registration must close after it opens.");
      return;
    }
    if (entryStarts && entryCloses && entryCloses <= entryStarts) {
      setErrorMessage("Guest list entry must close after it starts.");
      return;
    }
    setSavingSchedule(true);
    const { error } = await supabase
      .from("events")
      .update({
        application_opens_at: registrationOpens?.toISOString() ?? null,
        application_closes_at: registrationCloses?.toISOString() ?? null,
        application_link_closes_at: registrationCloses?.toISOString() ?? null,
        entry_starts_at: entryStarts?.toISOString() ?? null,
        entry_deadline: entryCloses?.toISOString() ?? null,
      })
      .eq("id", event.id)
      .eq("organizer_id", userId);
    setSavingSchedule(false);

    if (error) {
      setErrorMessage(`Could not update event times: ${error.message}`);
      return;
    }

    setEvents((current) => current.map((item) => item.id === event.id
      ? { ...item, application_opens_at: registrationOpens?.toISOString() ?? null, application_closes_at: registrationCloses?.toISOString() ?? null, application_link_closes_at: registrationCloses?.toISOString() ?? null, entry_starts_at: entryStarts?.toISOString() ?? null, entry_deadline: entryCloses?.toISOString() ?? null }
      : item));
    setEditingScheduleEventId("");
    setSuccessMessage("Event times updated.");
  }

  async function closeEntryNow(event: EventItem) {
    if (closingEntryEventId) return;
    if (!window.confirm(`Close entry for “${event.title}” now? QR scans after this time will show the existing “Approve anyway and check in” prompt.`)) return;

    const closedAt = new Date().toISOString();
    setErrorMessage("");
    setSuccessMessage("");
    setClosingEntryEventId(event.id);
    const { error } = await supabase
      .from("events")
      .update({ entry_closed_at: closedAt })
      .eq("id", event.id)
      .eq("organizer_id", userId);
    setClosingEntryEventId("");

    if (error) {
      setErrorMessage(`Could not close event entry: ${error.message}`);
      return;
    }

    setEvents((current) => current.map((item) => item.id === event.id ? { ...item, entry_closed_at: closedAt } : item));
    setCurrentTimeMs(Date.now());
    if (editingScheduleEventId === event.id) setScheduleEntryClosesAt(toLocalDateTimeInput(closedAt));
    setSuccessMessage(`Entry closed for ${event.title}. Scanned QRs will use the existing “Approve anyway and check in” confirmation after the cutoff.`);
  }

  useEffect(() => {
    let active = true;

    async function initialise() {
      const { data, error } = await supabase.auth.getUser();

      if (!active) return;

      if (error || !data.user) {
        window.location.replace("/organizer/login");
        return;
      }

      if (!hasAccountRole(data.user.user_metadata, "organizer")) {
        window.location.replace("/organizer/login?error=wrong_account_type");
        return;
      }

      setUserId(data.user.id);

      void (async () => {
        try {
          const accessToken = (await supabase.auth.getSession()).data.session?.access_token;
          if (!accessToken) return;
          const response = await fetch("/api/organizer/commission/status", {
            headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store",
          });
          if (!response.ok) return;
          const result = await response.json() as { claims?: CommissionClaimStatus[] };
          if (active) setCommissionClaimStatuses(Object.fromEntries((result.claims ?? []).map((claim) => [claim.eventId, claim.status])));
        } catch { /* Keep the event workspace usable if the optional status lookup is unavailable. */ }
      })();

      const { data: eventData, error: eventError } = await supabase
        .from("events")
        .select(
          "id, organizer_id, title, description, venue_name, city, state, application_opens_at, application_closes_at, application_link_closes_at, entry_starts_at, entry_deadline, entry_closed_at, capacity, status, listing_fee_status, created_at"
        )
        .eq("organizer_id", data.user.id)
        .order("created_at", { ascending: false });

      if (!active) return;

      if (eventError) {
        setErrorMessage(
          `Could not load events: ${eventError.message} (Code: ${eventError.code})`
        );
      } else {
        setEvents((eventData ?? []) as EventItem[]);
      }

      setLoading(false);
    }

    initialise();

    return () => {
      active = false;
    };
  }, [router, supabase]);

  async function handleCreateEvent(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    if (!userId) {
      setErrorMessage("Your session has expired. Please sign in again.");
      return;
    }

    const scheduleValues = [applicationOpensAt, registrationClosesAt, entryStartsAt, entryClosesAt]
      .filter(Boolean)
      .map((value) => new Date(value).getTime());
    if (scheduleValues.some((value) => !Number.isFinite(value))) {
      setErrorMessage("Enter valid dates and times.");
      return;
    }

    if (
      applicationOpensAt &&
      registrationClosesAt &&
      new Date(registrationClosesAt) <= new Date(applicationOpensAt)
    ) {
      setErrorMessage(
        "Guest list registration must close after it opens."
      );
      return;
    }

    if (
      entryStartsAt && entryClosesAt && new Date(entryClosesAt) <= new Date(entryStartsAt)
    ) {
      setErrorMessage("Guest list entry must close after it starts.");
      return;
    }

    if (capacity && Number(capacity) < 1) {
      setErrorMessage("Capacity must be at least 1.");
      return;
    }

    setSaving(true);

    const eventValues = {
        title: title.trim(),
        description: description.trim() || null,
        venue_name: venueName.trim() || null,
        city: (isCustomCity ? customCity : city).trim() || null,
        state: stateName || null,
        application_opens_at: applicationOpensAt
          ? new Date(applicationOpensAt).toISOString()
          : null,
        application_closes_at: registrationClosesAt
          ? new Date(registrationClosesAt).toISOString()
          : null,
        application_link_closes_at: registrationClosesAt
          ? new Date(registrationClosesAt).toISOString()
          : null,
        entry_starts_at: entryStartsAt
          ? new Date(entryStartsAt).toISOString()
          : null,
        entry_deadline: entryClosesAt
          ? new Date(entryClosesAt).toISOString()
          : null,
        capacity: capacity ? Number(capacity) : null,
    };
    const result = editingEventId
      ? await supabase.from("events").update(eventValues).eq("id", editingEventId).eq("organizer_id", userId).select("id").single()
      : await supabase.from("events").insert({ ...eventValues, organizer_id: userId, status: "draft", listing_fee_paise: 25000, listing_fee_status: "unpaid" }).select("id").single();
    const { data, error } = result;

    setSaving(false);

    if (error) {
      setErrorMessage(
        `Could not create event: ${error.message} (Code: ${error.code}). Check your events table permissions and required columns.`
      );
      return;
    }

    setSuccessMessage(editingEventId ? "Event details updated. The listing fee is not refundable." : "Event created successfully as a draft. Pay the listing fee to publish it.");
    clearEventForm();

    await loadEvents(userId);

    if (!data?.id) {
      setErrorMessage(
        "The event may have been saved, but its ID could not be returned."
      );
    }
  }

  async function togglePublish(event: EventItem) {
    setErrorMessage("");
    setSuccessMessage("");
    setUpdatingId(event.id);

    if (event.status === "published") {
      const { error } = await supabase.from("events").update({ status: "draft" }).eq("id", event.id).eq("organizer_id", userId);
      setUpdatingId("");
      if (error) { setErrorMessage(`Could not unpublish event: ${error.message}`); return; }
      setSuccessMessage("Event changed back to draft. Its listing fee remains non-refundable.");
      await loadEvents(userId);
      return;
    }

    if (event.listing_fee_status === "paid") {
      const { error } = await supabase.from("events").update({ status: "published" }).eq("id", event.id).eq("organizer_id", userId);
      setUpdatingId("");
      if (error) { setErrorMessage(`Could not publish event: ${error.message}`); return; }
      setSuccessMessage("Event published.");
      await loadEvents(userId);
      return;
    }
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/api/payments/listing-order", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ eventId: event.id }) });
      const checkout = await response.json().catch(() => ({})) as ListingCheckout & { error?: string };
      if (!response.ok) throw new Error(checkout.error || "Could not start the listing payment.");
      const Razorpay = (window as Window & { Razorpay?: new (options: ListingCheckoutOptions) => { open: () => void } }).Razorpay;
      if (!Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script"); script.src = "https://checkout.razorpay.com/v1/checkout.js"; script.async = true;
          script.onload = () => resolve(); script.onerror = () => reject(new Error("Could not load Razorpay Checkout.")); document.body.appendChild(script);
        });
      }
      const Checkout = (window as Window & { Razorpay?: new (options: ListingCheckoutOptions) => { open: () => void } }).Razorpay;
      if (!Checkout) throw new Error("Razorpay Checkout did not initialize.");
      const instance = new Checkout({ key: checkout.keyId, order_id: checkout.orderId, amount: checkout.amount, currency: checkout.currency, name: checkout.name, description: checkout.description, theme: { color: "#fbbf24" },
        handler: async (result) => {
          try {
            const verify = await fetch("/api/payments/listing-verify", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ eventId: event.id, ...result }) });
            const resultBody = await verify.json().catch(() => ({})) as { error?: string; message?: string };
            if (!verify.ok) throw new Error(resultBody.error || "Could not verify listing payment.");
            setSuccessMessage(resultBody.message || "Listing payment confirmed and event published."); await loadEvents(userId);
          } catch (caught) { setErrorMessage(caught instanceof Error ? caught.message : "Payment verification needs attention."); }
          finally { setUpdatingId(""); }
        },
        modal: { ondismiss: () => setUpdatingId("") },
      });
      instance.open();
    } catch (caught) { setUpdatingId(""); setErrorMessage(caught instanceof Error ? caught.message : "Could not start listing payment."); }
  }

  async function deleteDraftEvent(event: EventItem) {
    if (event.status !== "draft") return;
    const confirmed = window.confirm(
      `Permanently delete the draft “${event.title}”? This is only allowed when it has no guest applications or payment activity. This cannot be undone.`
    );
    if (!confirmed) return;

    setErrorMessage("");
    setSuccessMessage("");
    setDeletingEventId(event.id);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error("Your session expired. Please sign in again.");
      const response = await fetch("/api/organizer/events", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: event.id }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not delete this draft event.");
      setEvents((current) => current.filter((item) => item.id !== event.id));
      setSuccessMessage("Draft event deleted.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not delete this draft event.");
    } finally {
      setDeletingEventId("");
    }
  }

  async function copyEventLink(event: EventItem) {
    if (event.status !== "published") {
      setErrorMessage("Publish this event before sharing its public link.");
      return;
    }
    if (!siteOrigin) return;
    try {
      await navigator.clipboard.writeText(`${siteOrigin}/events/${event.id}`);
      setCopiedEventId(event.id);
      setSuccessMessage("Public event link copied. Share it with your guests.");
      window.setTimeout(() => setCopiedEventId((current) => current === event.id ? "" : current), 2500);
    } catch {
      setErrorMessage("Could not copy the link. Select and copy it from the event card.");
    }
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    const { error } = await supabase.auth.signOut();

    if (error) {
      setErrorMessage(`Could not sign out: ${error.message}`);
      setSigningOut(false);
      return;
    }

    window.location.replace("/");
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080b12] text-white">
        <p className="text-slate-400">Loading organizer dashboard...</p>
      </main>
    );
  }

  const publishedCount = events.filter(
    (event) => event.status === "published"
  ).length;

  return (
    <main className="min-h-screen bg-[#080b12] text-white">
      <SiteHeader
        area="organizer"
        current="organizer"
        actions={(
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="min-h-10 touch-manipulation rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold hover:border-amber-400 disabled:opacity-60 sm:px-4 sm:text-sm"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        )}
      />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <p className="text-sm font-bold tracking-[0.25em] text-amber-400">
          ORGANIZER WORKSPACE
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-extrabold sm:text-5xl">
              Manage your events
            </h1>
            <p className="mt-3 max-w-2xl leading-7 text-slate-400">
              Create guest-list events, configure application and entry
              deadlines, and control publication.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/organizer/applicants"
              className="rounded-xl border border-slate-700 px-5 py-3 text-center font-semibold text-slate-200 transition hover:border-amber-400 hover:text-white"
            >
              All applicants
            </Link>
            <Link
              href="/organizer/check-in"
              className="rounded-xl border border-amber-400 px-5 py-3 text-center font-bold text-amber-300 transition hover:bg-amber-400 hover:text-black"
            >
              Scan guest QR / Check in
            </Link>
            <button
              onClick={() => {
                setShowForm((current) => !current);
                setErrorMessage("");
                setSuccessMessage("");
              }}
              className="rounded-xl bg-amber-400 px-5 py-3 font-bold text-black hover:bg-amber-300"
            >
              {showForm ? "Close form" : "+ Create event"}
            </button>
          </div>
        </div>

        {errorMessage && (
          <div className="mt-6 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div className="mt-6 rounded-xl border border-emerald-900 bg-emerald-950/30 p-4 text-sm text-emerald-300">
            {successMessage}
          </div>
        )}

        <section className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-[#11141c] p-6">
            <p className="text-sm text-slate-400">Total events</p>
            <p className="mt-3 text-4xl font-extrabold">{events.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-[#11141c] p-6">
            <p className="text-sm text-slate-400">Published events</p>
            <p className="mt-3 text-4xl font-extrabold text-amber-400">
              {publishedCount}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-[#11141c] p-6">
            <p className="text-sm text-slate-400">Draft events</p>
            <p className="mt-3 text-4xl font-extrabold">
              {events.length - publishedCount}
            </p>
          </div>
        </section>

        {showForm && (
          <section className="mt-8 rounded-2xl border border-slate-800 bg-[#11141c] p-4 sm:p-8">
            <h2 className="text-2xl font-bold">{editingEventId ? "Edit event details" : "Create a new event"}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {editingEventId ? "Update the details guests will see. The ₹250 listing fee is non-refundable." : "Save a draft, then pay the non-refundable ₹250 listing fee to publish it."}
              </p>

            <form onSubmit={handleCreateEvent} className="mt-6 space-y-6">
              <div className="grid gap-5 md:grid-cols-2">
                <label className="block text-sm font-semibold">
                  Event title *
                  <input
                    className={inputClass}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Saturday Night Guest List"
                    required
                    maxLength={150}
                  />
                </label>

                <label className="block text-sm font-semibold">
                  Venue name
                  <input
                    className={inputClass}
                    value={venueName}
                    onChange={(e) => setVenueName(e.target.value)}
                    placeholder="e.g. The Grand Lounge"
                    maxLength={150}
                  />
                </label>

                <label className="block text-sm font-semibold">
                  State / union territory
                  <select
                    className={inputClass}
                    value={stateName}
                    onChange={(e) => {
                      setStateName(e.target.value);
                      setCity("");
                      setCustomCity("");
                    }}
                  >
                    <option value="">Choose a state or union territory</option>
                    {indiaLocations.map((state) => (
                      <option key={state.code} value={state.name}>{state.name}</option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm font-semibold">
                  City
                  <select
                    className={inputClass}
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    disabled={!stateName}
                  >
                    <option value="">{stateName ? "Choose a city" : "Choose a state first"}</option>
                    {stateCities.map((cityName) => (
                      <option key={cityName} value={cityName}>{cityName}</option>
                    ))}
                    {stateName && <option value="__other__">My city is not listed</option>}
                  </select>
                  {isCustomCity && (
                    <input
                      className={inputClass}
                      value={customCity}
                      onChange={(e) => setCustomCity(e.target.value)}
                      placeholder="Enter your city"
                      maxLength={100}
                      required
                    />
                  )}
                </label>

                <label className="block text-sm font-semibold">
                  Guest-list capacity
                  <input
                    className={inputClass}
                    type="number"
                    min="1"
                    max="100000"
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                    placeholder="200"
                  />
                </label>

                <label className="block text-sm font-semibold md:col-span-2">
                  Event description
                  <textarea
                    className={inputClass}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe the event and guest-list conditions..."
                    rows={4}
                    maxLength={5000}
                  />
                </label>
              </div>

              <div>
                <h3 className="text-lg font-bold">Guest list schedule</h3>
                <p className="mt-1 text-sm text-slate-400">
                  Leave a date blank if you have not decided it yet.
                </p>
                <div className="mt-4 grid gap-5 md:grid-cols-2">
                  <label className="block text-sm font-semibold">
                    Guest list registration starts at
                    <input
                      className={inputClass}
                      type="datetime-local"
                      value={applicationOpensAt}
                      onChange={(e) => setApplicationOpensAt(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm font-semibold">
                    Guest list registration closes at
                    <input
                      className={inputClass}
                      type="datetime-local"
                      value={registrationClosesAt}
                      min={applicationOpensAt || undefined}
                      onChange={(e) => setRegistrationClosesAt(e.target.value)}
                    />
                    <span className="mt-1 block text-xs font-normal text-slate-400">After this time, guests will see that registrations are closed.</span>
                  </label>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-bold">Entry schedule</h3>
                <p className="mt-1 text-sm text-slate-400">
                  Set the guest entry window. After entry closes, the scanner will warn you and let you approve entry anyway.
                </p>
                <div className="mt-4 grid gap-5 md:grid-cols-2">
                  <label className="block text-sm font-semibold">
                    Guest list entry starts at
                    <input
                      className={inputClass}
                      type="datetime-local"
                      value={entryStartsAt}
                      onChange={(e) => setEntryStartsAt(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm font-semibold">
                    Guest list entry closes at
                    <input className={inputClass} type="datetime-local" value={entryClosesAt} min={entryStartsAt || undefined} onChange={(e) => setEntryClosesAt(e.target.value)} />
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full rounded-xl bg-amber-400 px-6 py-3 font-bold text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {saving ? "Saving event..." : editingEventId ? "Save event changes" : "Save as draft"}
                </button>
                <button
                  type="button"
                  onClick={clearEventForm}
                  className="w-full rounded-xl border border-slate-700 px-6 py-3 font-semibold hover:border-amber-400 sm:w-auto"
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="mt-10">
          {selectedEventId && (
            <div className="mb-8 rounded-2xl border border-slate-800 bg-[#11141c] p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-2xl font-bold">
                  Guest list and entry records for{" "}
                  {events.find((event) => event.id === selectedEventId)?.title ??
                    "this event"}
                </h2>

                <div className="flex gap-2">
                  <button
                    onClick={() => loadApplications(selectedEventId)}
                    className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold hover:border-amber-400"
                  >
                    Refresh
                  </button>
                  <button
                    onClick={() => {
                      setSelectedEventId("");
                      setApplications([]);
                      setErrorMessage("");
                      setSuccessMessage("");
                    }}
                    className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold hover:border-amber-400"
                  >
                    Close
                  </button>
                </div>
              </div>

              {loadingApplications ? (
                <p className="mt-5 text-slate-400">Loading applications...</p>
              ) : applications.length === 0 ? (
                <p className="mt-5 text-slate-400">
                  No applications for this event yet.
                </p>
              ) : (
                <div className="mt-5 space-y-3">
                  {applications.map((application) => (
                    <article
                      key={application.id}
                      className="rounded-xl border border-slate-800 bg-[#0b0e15] p-4"
                    >
                      <p className="font-semibold">
                        {application.guest_name || application.guest_email?.split("@")[0] || "Guest name unavailable"}
                      </p>
                      <p className="mt-1 text-sm text-slate-400">{application.guest_email || "Guest email unavailable"}</p>
                      <p className="mt-2 text-sm capitalize text-slate-300">
                        Status: {application.status}
                      </p>
                      <p className="mt-1 text-sm text-slate-400">
                        Application fee: ₹
                        {application.application_fee_paise / 100} · Payment:{" "}
                        <span className="capitalize">
                          {application.payment_status}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Applied:{" "}
                        {new Date(application.created_at).toLocaleString(
                          "en-IN"
                        )}
                      </p>

                      <p className="mt-3 text-sm text-slate-300">
                        WhatsApp: {application.guest_phone || "Not provided"}
                      </p>
                      {application.whatsapp_pass_sent_at && (
                        <p className="mt-1 text-xs text-emerald-400">
                          WhatsApp: {application.whatsapp_delivery_status || "accepted"}
                          {application.whatsapp_status_updated_at ? ` · updated ${new Date(application.whatsapp_status_updated_at).toLocaleString("en-IN")}` : ` · accepted ${new Date(application.whatsapp_pass_sent_at).toLocaleString("en-IN")}`}
                        </p>
                      )}
                      {application.whatsapp_delivery_error && <p className="mt-1 text-xs text-red-300">WhatsApp delivery error: {application.whatsapp_delivery_error}</p>}

                      {application.checked_in_at && (
                        <p className="mt-3 text-sm font-semibold text-emerald-400">
                          Checked in at{" "}
                          {new Date(application.checked_in_at).toLocaleString(
                            "en-IN"
                          )}
                        </p>
                      )}

                      {application.status === "pending" && (
                        <div className="mt-4 flex gap-2">
                          <button
                            onClick={() =>
                              reviewApplication(application, "approved")
                            }
                            disabled={
                              reviewingApplicationId === application.id || application.payment_status !== "paid"
                            }
                            title={application.payment_status !== "paid" ? "Collect the application fee before approval." : undefined}
                            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
                          >
                            {reviewingApplicationId === application.id
                              ? "Updating..."
                              : application.payment_status === "paid" ? "Approve" : "Awaiting payment"}
                          </button>
                          <button
                            onClick={() =>
                              reviewApplication(application, "rejected")
                            }
                            disabled={
                              reviewingApplicationId === application.id
                            }
                            className="rounded-xl border border-red-800 px-4 py-2 text-sm font-bold text-red-300 disabled:opacity-50"
                          >
                            {reviewingApplicationId === application.id
                              ? "Updating..."
                              : "Reject"}
                          </button>
                        </div>
                      )}

                      {application.status === "approved" &&
                        !application.checked_in_at && (
                          <div className="mt-4">
                            <button
                              onClick={() => checkInApplication(application)}
                              disabled={
                                checkingInApplicationId === application.id
                              }
                              className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {checkingInApplicationId === application.id
                                ? "Checking in..."
                                : "Check in guest"}
                            </button>
                            {application.payment_status !== "paid" && (
                              <p className="mt-2 text-xs text-amber-300">
                                Payment is still pending. This check-in does not
                                mark the fee as paid.
                              </p>
                            )}
                          </div>
                        )}

                      {application.status === "approved" && (
                        <button
                          onClick={() => sendWhatsAppPass(application.id, true)}
                          disabled={sendingWhatsAppApplicationId === application.id || !application.guest_phone}
                          className="mt-4 rounded-xl border border-emerald-700 px-4 py-2 text-sm font-bold text-emerald-300 hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {sendingWhatsAppApplicationId === application.id
                            ? "Sending WhatsApp pass..."
                            : application.whatsapp_pass_sent_at
                              ? "Resend pass on WhatsApp"
                              : "Send pass on WhatsApp"}
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold">Your events</h2>
              <p className="mt-2 text-sm text-slate-400">
                Only events belonging to your account are shown.
              </p>
            </div>
            <button
              onClick={() => loadEvents(userId)}
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold hover:border-amber-400"
            >
              Refresh
            </button>
          </div>

          {events.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-slate-800 bg-[#11141c] p-8">
              <h3 className="text-lg font-bold">No events yet</h3>
              <p className="mt-2 text-sm text-slate-400">
                Create your first event to begin setting up its guest list.
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="mt-5 rounded-xl bg-amber-400 px-5 py-3 font-bold text-black hover:bg-amber-300"
              >
                Create your first event
              </button>
            </div>
          ) : (
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              {events.map((event) => (
                <article
                  key={event.id}
                  className="rounded-2xl border border-slate-800 bg-[#11141c] p-4 sm:p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h3 className="text-xl font-bold">{event.title}</h3>
                    <span className="rounded-full border border-slate-700 px-3 py-1 text-xs capitalize text-slate-300">
                      {event.status}
                    </span>
                  </div>

                  <p className="mt-3 text-sm text-slate-400">
                    {[event.venue_name, event.city, event.state].filter(Boolean).join(" · ") ||
                      "Venue and city not specified"}
                  </p>

                  <div className="mt-4 rounded-xl border border-slate-800 bg-[#0b0e15] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Public event link</p>
                    {siteOrigin ? (
                      <p className="mt-1 break-all text-sm text-slate-200">{siteOrigin}/events/{event.id}</p>
                    ) : (
                      <p className="mt-1 text-sm text-slate-500">Preparing link…</p>
                    )}
                    {event.status === "published" ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => void copyEventLink(event)} className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-bold text-black hover:bg-amber-300">
                          {copiedEventId === event.id ? "Copied" : "Copy link"}
                        </button>
                        <a href={`/events/${event.id}`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold hover:border-amber-400">Open public page</a>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-amber-300">Publish the event to make this link available to guests.</p>
                    )}
                  </div>

                  <div className="mt-4 grid gap-1 text-sm text-slate-300 sm:grid-cols-2">
                    <p>Guest list registration starts at: {event.application_opens_at ? new Date(event.application_opens_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Not set"}</p>
                    <p>Guest list registration closes at: {(event.application_link_closes_at ?? event.application_closes_at) ? new Date((event.application_link_closes_at ?? event.application_closes_at)!).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Not set"}</p>
                    <p>Guest list entry starts at: {event.entry_starts_at ? new Date(event.entry_starts_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Not set"}</p>
                    <p>Guest list entry closes at: {(event.entry_closed_at ?? event.entry_deadline) ? new Date((event.entry_closed_at ?? event.entry_deadline)!).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Not set"}</p>
                  </div>

                  {event.description && (
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                      {event.description}
                    </p>
                  )}

                  <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-[#0b0e15] p-3">
                      <p className="text-slate-500">Capacity</p>
                      <p className="mt-1 font-semibold">
                        {event.capacity ?? "Not set"}
                      </p>
                    </div>
                    <div className="rounded-xl bg-[#0b0e15] p-3">
                      <p className="text-slate-500">Created</p>
                      <p className="mt-1 font-semibold">
                        {new Date(event.created_at).toLocaleDateString("en-IN")}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-5">
                    <p className="text-xs text-slate-500">
                      {event.listing_fee_status === "paid" ? "Listing fee paid: ₹250 (non-refundable)" : "Listing fee: ₹250 (required before publishing)"}
                    </p>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => beginEventEdit(event)}
                        className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold hover:border-amber-400"
                      >
                        Edit event details
                      </button>
                      {event.status === "draft" && (
                        <button
                          onClick={() => void deleteDraftEvent(event)}
                          disabled={deletingEventId === event.id || updatingId === event.id}
                          className="rounded-xl border border-rose-800 px-4 py-2 text-sm font-semibold text-rose-300 hover:border-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingEventId === event.id ? "Deleting..." : "Delete draft"}
                        </button>
                      )}
                      <button
                        onClick={() => beginScheduleEdit(event)}
                        className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold hover:border-amber-400"
                      >
                        Edit guest-list and scan times
                      </button>
                      {event.status === "published" && (
                        <button
                          type="button"
                          onClick={() => void closeEntryNow(event)}
                          disabled={closingEntryEventId === event.id || Boolean(event.entry_closed_at) || Boolean(event.entry_deadline && currentTimeMs >= new Date(event.entry_deadline).getTime())}
                          className="rounded-xl border border-rose-800 px-4 py-2 text-sm font-semibold text-rose-300 hover:border-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {closingEntryEventId === event.id ? "Closing entry…" : event.entry_closed_at || (event.entry_deadline && currentTimeMs >= new Date(event.entry_deadline).getTime()) ? "Entry closed" : "Close entry now"}
                        </button>
                      )}
                      <Link
                        href={`/organizer/applicants?eventId=${encodeURIComponent(event.id)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold hover:border-amber-400"
                      >
                        Review applications
                      </Link>
                      <button
                        onClick={() => loadApplications(event.id)}
                        className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold hover:border-amber-400"
                      >
                        Quick review
                      </button>
                      {commissionClaimStatuses[event.id] === "paid" ? (
                        <span className="rounded-xl border border-emerald-800 px-4 py-2 text-sm font-semibold text-emerald-300">Commission paid</span>
                      ) : commissionClaimStatuses[event.id] && !["rejected", "failed", "cancelled"].includes(commissionClaimStatuses[event.id]) ? (
                        <Link
                          href={`/organizer/commission?eventId=${encodeURIComponent(event.id)}`}
                          className="rounded-xl border border-sky-800 px-4 py-2 text-sm font-semibold text-sky-200 hover:border-sky-500"
                        >
                          Commission status
                        </Link>
                      ) : event.entry_closed_at || (event.entry_deadline && currentTimeMs >= new Date(event.entry_deadline).getTime()) ? (
                        <Link
                          href={`/organizer/commission?eventId=${encodeURIComponent(event.id)}`}
                          className="rounded-xl bg-emerald-300 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-200"
                        >
                          Claim commission
                        </Link>
                      ) : (
                        <button
                          type="button"
                          disabled
                          title={event.entry_deadline ? "Available after guest-list entry closes" : "Set an entry closing time first"}
                          className="cursor-not-allowed rounded-xl border border-slate-800 px-4 py-2 text-sm font-semibold text-slate-500"
                        >
                          Claim commission after entry closes
                        </button>
                      )}
                      <button
                        onClick={() => togglePublish(event)}
                        disabled={updatingId === event.id}
                        className={`rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50 ${
                          event.status === "published"
                            ? "border border-slate-700 hover:border-amber-400"
                            : "bg-amber-400 text-black hover:bg-amber-300"
                        }`}
                      >
                        {updatingId === event.id
                          ? "Updating..."
                          : event.status === "published"
                            ? "Unpublish"
                            : "Publish event"}
                      </button>
                    </div>
                  </div>

                  {editingScheduleEventId === event.id && (
                    <div className="mt-5 rounded-xl border border-amber-500/30 bg-[#0b0e15] p-4">
                      <h4 className="font-bold">Event timing</h4>
                      <p className="mt-1 text-sm text-slate-400">
                        After guest list entry closes, the scanner asks for confirmation before checking a guest in.
                      </p>
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <label className="text-sm font-semibold">Guest list registration starts at<input className={inputClass} type="datetime-local" value={scheduleRegistrationOpensAt} onChange={(e) => setScheduleRegistrationOpensAt(e.target.value)} /></label>
                        <label className="text-sm font-semibold">Guest list registration closes at<input className={inputClass} type="datetime-local" value={scheduleRegistrationClosesAt} min={scheduleRegistrationOpensAt || undefined} onChange={(e) => setScheduleRegistrationClosesAt(e.target.value)} /></label>
                        <label className="text-sm font-semibold">Guest list entry starts at<input className={inputClass} type="datetime-local" value={scheduleEntryStartsAt} onChange={(e) => setScheduleEntryStartsAt(e.target.value)} /></label>
                        <label className="text-sm font-semibold">Guest list entry closes at<input className={inputClass} type="datetime-local" value={scheduleEntryClosesAt} min={scheduleEntryStartsAt || undefined} onChange={(e) => setScheduleEntryClosesAt(e.target.value)} /></label>
                      </div>
                      <div className="mt-4 flex gap-3">
                        <button onClick={() => saveEventSchedule(event)} disabled={savingSchedule} className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-black disabled:opacity-50">
                          {savingSchedule ? "Saving..." : "Save times"}
                        </button>
                        <button onClick={() => setEditingScheduleEventId("")} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
