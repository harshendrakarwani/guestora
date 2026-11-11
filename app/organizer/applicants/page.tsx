"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import SiteHeader from "@/components/site-header";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { hasAccountRole } from "@/lib/account-roles";
import { downloadXlsx } from "@/lib/export-xlsx";

type EventRecord = {
  id: string;
  title: string;
  venue_name: string | null;
  city: string | null;
  state: string | null;
};

type ApplicantRecord = {
  id: string;
  event_id: string;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  instagram_username: string | null;
  guest_avatar_url: string | null;
  whatsapp_pass_sent_at: string | null;
  whatsapp_delivery_status: string | null;
  whatsapp_status_updated_at: string | null;
  whatsapp_delivery_error: string | null;
  status: string;
  auto_rejected: boolean;
  application_fee_paise: number;
  payment_status: string;
  checked_in_at: string | null;
  reviewed_at: string | null;
  created_at: string;
  event: EventRecord;
};

function displayDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function locationLabel(event: EventRecord): string {
  return [event.venue_name, event.city, event.state].filter(Boolean).join(" · ") || "Location not specified";
}

export default function OrganizerApplicantsPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [applicants, setApplicants] = useState<ApplicantRecord[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "rejected">("all");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [processingApplicantId, setProcessingApplicantId] = useState("");
  const [processingAction, setProcessingAction] = useState<"approve" | "reject" | "resend" | "refund" | "">("");
  const [selectedApplicantIds, setSelectedApplicantIds] = useState<string[]>([]);
  const [batchAction, setBatchAction] = useState<"approve" | "reject" | "">("");
  const applicantsRequest = useRef<AbortController | null>(null);

  async function loadApplicants(eventId = selectedEventId, isRefresh = false): Promise<EventRecord[]> {
    applicantsRequest.current?.abort();
    const controller = new AbortController();
    applicantsRequest.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 25_000);
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setErrorMessage("");
    try {
      // getSession reads the local session and avoids an extra Auth network call;
      // the API still validates the token before returning organizer data.
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (sessionError || !session) {
        router.replace("/organizer/login");
        return [];
      }
      if (!hasAccountRole(session.user.user_metadata, "organizer")) {
        router.replace("/organizer/login?error=wrong_account_type");
        return [];
      }

      const query = eventId ? `?eventId=${encodeURIComponent(eventId)}` : "";
      const response = await fetch(`/api/organizer/applicants${query}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
        signal: controller.signal,
      });
      const result = (await response.json().catch(() => ({}))) as {
        events?: EventRecord[];
        applicants?: ApplicantRecord[];
        selectedEventId?: string;
        error?: string;
      };
      if (controller.signal.aborted) return [];
      const loadedEvents = result.events ?? [];
      setEvents(loadedEvents);
      if (!response.ok) {
        setErrorMessage(result.error || "Could not load applicants.");
        setApplicants([]);
      } else {
        setApplicants(result.applicants ?? []);
        const resolvedEventId = eventId || result.selectedEventId;
        if (resolvedEventId) setSelectedEventId(resolvedEventId);
        if (!eventId && result.selectedEventId) {
          window.history.replaceState(null, "", `/organizer/applicants?eventId=${encodeURIComponent(result.selectedEventId)}`);
        }
      }
      return loadedEvents;
    } catch (error) {
      if (!controller.signal.aborted || timedOut) {
        setErrorMessage(timedOut
          ? "Loading applicants took too long. Check your connection and try Refresh."
          : error instanceof Error ? `Could not load applicants: ${error.message}` : "Could not load applicants. Please try Refresh.");
        setApplicants([]);
      }
      return [];
    } finally {
      window.clearTimeout(timeout);
      if (applicantsRequest.current === controller) {
        applicantsRequest.current = null;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  async function approveApplicant(applicant: ApplicantRecord) {
    if (applicant.status !== "pending" || processingApplicantId) return;
    if (applicant.payment_status !== "paid") {
      setErrorMessage("This application cannot be approved until its application fee is paid.");
      return;
    }
    setErrorMessage("");
    setSuccessMessage("");
    setProcessingApplicantId(applicant.id);
    setProcessingAction("approve");
    const reviewedAt = new Date().toISOString();

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      router.replace("/organizer/login");
      setProcessingApplicantId("");
      setProcessingAction("");
      return;
    }

    const { data: updated, error } = await supabase
      .from("guest_applications")
      .update({
        status: "approved",
        reviewed_by: authData.user.id,
        reviewed_at: reviewedAt,
      })
      .eq("id", applicant.id)
      .eq("event_id", applicant.event_id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (error) {
      setErrorMessage(`Could not approve this application: ${error.message}`);
      setProcessingApplicantId("");
      setProcessingAction("");
      return;
    }
    if (!updated) {
      setErrorMessage("This application has already changed. Refresh applicants and try again.");
      setProcessingApplicantId("");
      setProcessingAction("");
      return;
    }

    setApplicants((current) => current.map((item) =>
      item.id === applicant.id ? { ...item, status: "approved", reviewed_at: reviewedAt } : item
    ));
    setSelectedApplicantIds((current) => current.filter((id) => id !== applicant.id));

    try {
      const accessToken = (await supabase.auth.getSession()).data.session?.access_token;
      if (!accessToken) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/api/whatsapp/send-pass", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ applicationId: applicant.id, force: true }),
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) {
        setSuccessMessage(`Application approved. WhatsApp pass not sent: ${result.error || "Please try again."}`);
      } else {
        setSuccessMessage(`Application approved. ${result.message || "WhatsApp pass sent."}`);
      }
    } catch (error) {
      setSuccessMessage(`Application approved. WhatsApp pass not sent: ${error instanceof Error ? error.message : "Please try again."}`);
    } finally {
      setProcessingApplicantId("");
      setProcessingAction("");
    }
  }

  async function sendWhatsAppPass(applicant: ApplicantRecord) {
    if (applicant.status !== "approved" || applicant.payment_status !== "paid" || processingApplicantId) return;
    setErrorMessage("");
    setSuccessMessage("");
    setProcessingApplicantId(applicant.id);
    setProcessingAction("resend");

    try {
      const accessToken = (await supabase.auth.getSession()).data.session?.access_token;
      if (!accessToken) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/api/whatsapp/send-pass", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ applicationId: applicant.id, force: true }),
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) {
        setErrorMessage(`WhatsApp pass not sent: ${result.error || "Please try again."}`);
        return;
      }
      setSuccessMessage(result.message || "Pass sent on WhatsApp.");
      await loadApplicants(selectedEventId, true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not send the WhatsApp pass. Please try again.");
    } finally {
      setProcessingApplicantId("");
      setProcessingAction("");
    }
  }

  async function rejectApplicant(applicant: ApplicantRecord) {
    if (applicant.status !== "pending" || processingApplicantId) return;
    setErrorMessage("");
    setSuccessMessage("");
    setProcessingApplicantId(applicant.id);
    setProcessingAction("reject");
    const reviewedAt = new Date().toISOString();

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      router.replace("/organizer/login");
      setProcessingApplicantId("");
      setProcessingAction("");
      return;
    }

    const { data: updated, error } = await supabase
      .from("guest_applications")
      .update({
        status: "rejected",
        reviewed_by: authData.user.id,
        reviewed_at: reviewedAt,
      })
      .eq("id", applicant.id)
      .eq("event_id", applicant.event_id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (error) {
      setErrorMessage(`Could not reject this application: ${error.message}`);
      setProcessingApplicantId("");
      setProcessingAction("");
      return;
    }
    if (!updated) {
      setErrorMessage("This application has already changed. Refresh applicants and try again.");
      setProcessingApplicantId("");
      setProcessingAction("");
      return;
    }

    setApplicants((current) => current.map((item) =>
      item.id === applicant.id ? { ...item, status: "rejected", reviewed_at: reviewedAt } : item
    ));
    setSelectedApplicantIds((current) => current.filter((id) => id !== applicant.id));

    if (applicant.payment_status !== "paid") {
      setSuccessMessage("Application rejected. No captured payment was taken, so no refund is due. If a pending payment is captured later, Guestora will refund it automatically.");
      setProcessingApplicantId("");
      setProcessingAction("");
      return;
    }

    try {
      const accessToken = (await supabase.auth.getSession()).data.session?.access_token;
      if (!accessToken) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/api/payments/refund", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: applicant.id }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string; error?: string; refunded?: boolean };
      if (response.ok) {
        setApplicants((current) => current.map((item) => item.id === applicant.id
          ? { ...item, payment_status: result.refunded ? "refunded" : "refund_pending" }
          : item));
      }
      setSuccessMessage(response.ok
        ? `Application rejected. ${result.message || "Refund initiated; it will show as complete after Razorpay confirms it."}`
        : `Application rejected, but the refund needs attention: ${result.error || "Please check Razorpay Dashboard."}`);
    } catch (caught) {
      setSuccessMessage(`Application rejected, but the refund needs attention: ${caught instanceof Error ? caught.message : "Please check Razorpay Dashboard."}`);
    } finally {
      setProcessingApplicantId("");
      setProcessingAction("");
    }
  }

  async function retryRefund(applicant: ApplicantRecord) {
    if (applicant.status !== "rejected" || applicant.payment_status !== "paid" || processingApplicantId) return;
    setErrorMessage("");
    setSuccessMessage("");
    setProcessingApplicantId(applicant.id);
    setProcessingAction("refund");
    try {
      const accessToken = (await supabase.auth.getSession()).data.session?.access_token;
      if (!accessToken) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/api/payments/refund", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: applicant.id }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string; error?: string; refunded?: boolean };
      if (!response.ok) {
        setErrorMessage(`Refund not started: ${result.error || "Please check Razorpay Dashboard."}`);
        return;
      }
      setApplicants((current) => current.map((item) => item.id === applicant.id
        ? { ...item, payment_status: result.refunded ? "refunded" : "refund_pending" }
        : item));
      setSuccessMessage(result.message || "Refund initiated. It will show as complete after Razorpay confirms it.");
    } catch (caught) {
      setErrorMessage(caught instanceof Error ? caught.message : "Could not start the refund. Please check Razorpay Dashboard.");
    } finally {
      setProcessingApplicantId("");
      setProcessingAction("");
    }
  }

  useEffect(() => {
    let active = true;
    const requestedEventId = new URLSearchParams(window.location.search).get("eventId") || "";
    void Promise.resolve().then(() => {
      if (active) void loadApplicants(requestedEventId);
    });
    return () => {
      active = false;
      applicantsRequest.current?.abort();
    };
    // Supabase client is stable for this mounted page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, supabase]);

  const filteredApplicants = useMemo(() => {
    const query = search.trim().toLowerCase();
    return applicants.filter((applicant) => {
      if (statusFilter !== "all" && applicant.status !== statusFilter) return false;
      if (!query) return true;
      return [
      applicant.guest_email,
      applicant.guest_phone,
      applicant.guest_name,
      applicant.status,
      applicant.payment_status,
      applicant.event.title,
      applicant.event.venue_name,
      applicant.event.city,
      applicant.event.state,
      applicant.whatsapp_delivery_status,
      ].some((value) => value?.toLowerCase().includes(query));
    });
  }, [applicants, search, statusFilter]);

  const selectedApplicants = applicants.filter((applicant) =>
    selectedApplicantIds.includes(applicant.id) && applicant.status === "pending"
  );
  const visiblePendingApplicants = filteredApplicants.filter((applicant) => applicant.status === "pending");
  const allVisiblePendingSelected = visiblePendingApplicants.length > 0 && visiblePendingApplicants.every((applicant) =>
    selectedApplicantIds.includes(applicant.id)
  );

  function toggleApplicantSelection(applicantId: string) {
    setSelectedApplicantIds((current) => current.includes(applicantId)
      ? current.filter((id) => id !== applicantId)
      : [...current, applicantId]
    );
  }

  function toggleVisiblePendingSelection() {
    setSelectedApplicantIds((current) => allVisiblePendingSelected
      ? current.filter((id) => !visiblePendingApplicants.some((applicant) => applicant.id === id))
      : [...new Set([...current, ...visiblePendingApplicants.map((applicant) => applicant.id)])]
    );
  }

  async function reviewSelectedApplicants(action: "approve" | "reject") {
    const targets = selectedApplicants.filter((applicant) => action === "reject" || applicant.payment_status === "paid");
    const unpaidSkipped = selectedApplicants.length - targets.length;
    if (!targets.length || batchAction || processingApplicantId) return;
    if (action === "reject" && !window.confirm(`Reject ${targets.length} selected application${targets.length === 1 ? "" : "s"}? Paid applications will have refunds initiated.`)) return;

    setBatchAction(action);
    setErrorMessage("");
    setSuccessMessage("");
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      router.replace("/organizer/login");
      setBatchAction("");
      return;
    }
    const accessToken = (await supabase.auth.getSession()).data.session?.access_token;
    if (!accessToken) {
      setErrorMessage("Your session expired. Sign in again and retry.");
      setBatchAction("");
      return;
    }

    let changed = 0;
    let sideEffectIssues = 0;
    let refundsStarted = 0;
    const processedIds: string[] = [];

    for (const applicant of targets) {
      const nextStatus = action === "approve" ? "approved" : "rejected";
      const reviewedAt = new Date().toISOString();
      const { data: updated, error } = await supabase
        .from("guest_applications")
        .update({ status: nextStatus, reviewed_by: authData.user.id, reviewed_at: reviewedAt })
        .eq("id", applicant.id)
        .eq("event_id", applicant.event_id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

      if (error || !updated) {
        sideEffectIssues += 1;
        continue;
      }

      changed += 1;
      processedIds.push(applicant.id);
      setApplicants((current) => current.map((item) => item.id === applicant.id ? { ...item, status: nextStatus, reviewed_at: reviewedAt } : item));

      if (action === "approve") {
        try {
          const response = await fetch("/api/whatsapp/send-pass", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ applicationId: applicant.id, force: true }),
          });
          if (!response.ok) sideEffectIssues += 1;
        } catch {
          sideEffectIssues += 1;
        }
      } else if (applicant.payment_status === "paid") {
        try {
          const response = await fetch("/api/payments/refund", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ applicationId: applicant.id }),
          });
          const result = await response.json().catch(() => ({})) as { refunded?: boolean };
          if (response.ok) {
            refundsStarted += 1;
            setApplicants((current) => current.map((item) => item.id === applicant.id
              ? { ...item, payment_status: result.refunded ? "refunded" : "refund_pending" }
              : item));
          } else sideEffectIssues += 1;
        } catch {
          sideEffectIssues += 1;
        }
      }
    }

    setSelectedApplicantIds((current) => current.filter((id) => !processedIds.includes(id)));
    setBatchAction("");
    const actionLabel = action === "approve" ? "approved" : "rejected";
    const skippedNote = unpaidSkipped ? ` ${unpaidSkipped} unpaid application${unpaidSkipped === 1 ? " was" : "s were"} skipped; only paid applications can be approved.` : "";
    const issueNote = sideEffectIssues ? ` ${sideEffectIssues} item${sideEffectIssues === 1 ? " needs" : "s need"} attention (a status update, WhatsApp pass, or refund did not complete).` : "";
    const refundNote = action === "reject" ? ` Refunds initiated for ${refundsStarted} paid application${refundsStarted === 1 ? "" : "s"}.` : " WhatsApp passes were requested for the approved applications.";
    setSuccessMessage(`${changed} of ${targets.length} selected application${targets.length === 1 ? "" : "s"} ${actionLabel}.${refundNote}${skippedNote}${issueNote}`);
  }

  function exportApplicants() {
    const rows: Array<Array<string | number>> = [
      ["S.No", "Guest name", "Instagram username", "Email", "WhatsApp number", "Applied at", "Checked in at", "Approved or rejected at", "Approval status"],
      ...filteredApplicants.map((applicant, index) => [
        String(index + 1),
        applicant.guest_name || applicant.guest_email?.split("@")[0] || "Name not provided",
        applicant.instagram_username ? `@${applicant.instagram_username}` : "",
        applicant.guest_email ?? "",
        applicant.guest_phone ?? "",
        displayDate(applicant.created_at),
        displayDate(applicant.checked_in_at),
        applicant.status === "approved" || applicant.status === "rejected" ? displayDate(applicant.reviewed_at) : "",
        applicant.status.charAt(0).toUpperCase() + applicant.status.slice(1),
      ]),
    ];
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const eventName = events.find((event) => event.id === selectedEventId)?.title;
    const safeEventName = (eventName || "event").trim().replace(/[<>:"/\\|?*]/g, "").replace(/[\x00-\x1f]/g, "").replace(/\s+/g, "-");
    downloadXlsx(`${safeEventName}-applicants-${date}.xlsx`, "Applicants", rows, eventName, 8, [7, 24, 24, 36, 24, 24, 24, 30, 18]);
  }

  const pendingCount = applicants.filter((item) => item.status === "pending").length;
  const approvedCount = applicants.filter((item) => item.status === "approved").length;

  return (
    <main className="min-h-screen bg-[#080b12] text-white">
      <SiteHeader area="organizer" current="applicants" />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <p className="text-xs font-extrabold tracking-[0.25em] text-amber-400">ORGANIZER WORKSPACE</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black sm:text-5xl">Event applicants</h1>
            <p className="mt-2 text-slate-400">Review applications for one event at a time.</p>
          </div>
          <button
            type="button"
            onClick={exportApplicants}
            disabled={!filteredApplicants.length || loading}
            className="w-full rounded-xl bg-amber-400 px-5 py-3 font-bold text-black transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            Save as Excel
          </button>
        </div>

        {errorMessage && <p role="alert" className="mt-6 rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-300">{errorMessage}</p>}
        {successMessage && <p role="status" className="mt-6 rounded-xl border border-emerald-900 bg-emerald-950/40 p-4 text-emerald-300">{successMessage}</p>}

        <section className="mt-7 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-[#11141c] p-4 sm:p-5"><p className="text-sm text-slate-400">Total applicants</p><p className="mt-2 text-3xl font-black">{applicants.length}</p></div>
          <div className="rounded-2xl border border-slate-800 bg-[#11141c] p-4 sm:p-5"><p className="text-sm text-slate-400">Awaiting review</p><p className="mt-2 text-3xl font-black text-amber-300">{pendingCount}</p></div>
          <div className="rounded-2xl border border-slate-800 bg-[#11141c] p-4 sm:p-5"><p className="text-sm text-slate-400">Approved</p><p className="mt-2 text-3xl font-black text-emerald-300">{approvedCount}</p></div>
        </section>

        <div className="mt-7 flex flex-wrap gap-3">
          <label className="min-w-0 flex-1 text-sm font-semibold text-slate-300">
            Event
            <select
              value={selectedEventId}
              onChange={(event) => {
                const nextEventId = event.target.value;
                setSelectedEventId(nextEventId);
                setSelectedApplicantIds([]);
                window.history.replaceState(null, "", nextEventId
                  ? `/organizer/applicants?eventId=${encodeURIComponent(nextEventId)}`
                  : "/organizer/applicants");
                void loadApplicants(nextEventId);
              }}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-[#11151e] px-4 py-3 text-white outline-none focus:border-amber-400"
            >
              {!selectedEventId && <option value="">Choose an event</option>}
              {events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
            </select>
          </label>
          <label className="min-w-0 flex-1 text-sm font-semibold text-slate-300">
            Search applicants
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Email, phone, event, city, state, or status"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-[#11151e] px-4 py-3 text-white outline-none focus:border-amber-400"
            />
          </label>
          <label className="min-w-0 flex-1 text-sm font-semibold text-slate-300">
            Filter status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | "approved" | "rejected")}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-[#11151e] px-4 py-3 text-white outline-none focus:border-amber-400"
            >
              <option value="all">All applicants</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void loadApplicants(selectedEventId, true)}
            disabled={refreshing || loading}
            className="self-end rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold hover:border-amber-400 disabled:opacity-50"
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <p className="mt-4 text-sm text-slate-500">
          {loading ? "Loading applications..." : `${filteredApplicants.length} of ${applicants.length} applicants`}
          {search && !loading ? " · Excel export includes these search results" : ""}
        </p>

        {selectedApplicants.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-700/50 bg-amber-950/30 p-4">
            <p className="mr-auto text-sm font-semibold text-amber-100">{selectedApplicants.length} pending selected</p>
            <button type="button" onClick={() => void reviewSelectedApplicants("approve")} disabled={Boolean(batchAction) || Boolean(processingApplicantId) || !selectedApplicants.some((item) => item.payment_status === "paid")} className="rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-bold text-black hover:bg-amber-300 disabled:cursor-wait disabled:opacity-50">
              {batchAction === "approve" ? "Approving..." : "Approve selected"}
            </button>
            <button type="button" onClick={() => void reviewSelectedApplicants("reject")} disabled={Boolean(batchAction) || Boolean(processingApplicantId)} className="rounded-xl border border-red-800 px-4 py-2.5 text-sm font-semibold text-red-300 hover:border-red-500 disabled:cursor-wait disabled:opacity-50">
              {batchAction === "reject" ? "Rejecting..." : "Reject selected"}
            </button>
            <button type="button" onClick={() => setSelectedApplicantIds([])} disabled={Boolean(batchAction)} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:border-slate-500 disabled:opacity-50">Clear selection</button>
          </div>
        )}

        {loading ? (
          <div className="mt-5 rounded-2xl border border-slate-800 bg-[#11141c] p-8 text-slate-400">Loading all event applicants...</div>
        ) : !errorMessage && filteredApplicants.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-slate-800 bg-[#11141c] p-8">
            <h2 className="text-xl font-bold">{applicants.length ? "No applicants match your search" : "No applicants yet"}</h2>
            <p className="mt-2 text-slate-400">{selectedEventId ? "This event has no guest applications yet." : "Create an event to start receiving applications."}</p>
          </div>
        ) : (
          <>
            <div className="mt-5 hidden overflow-hidden rounded-2xl border border-slate-800 bg-[#11141c] md:block">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="bg-[#171b25] text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-4 py-3"><input type="checkbox" aria-label="Select all visible pending applicants" checked={allVisiblePendingSelected} onChange={toggleVisiblePendingSelection} disabled={Boolean(batchAction) || visiblePendingApplicants.length === 0} className="h-4 w-4 accent-amber-400" /></th>
                      {["Applicant", "Event", "Status", "Payment", "Applied", "Check-in", "Action"].map((heading) => <th key={heading} className="px-4 py-3 font-semibold">{heading}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredApplicants.map((applicant) => (
                      <tr key={applicant.id} className="align-top">
                        <td className="px-4 py-4"><input type="checkbox" aria-label={`Select ${applicant.guest_name || applicant.guest_email || "applicant"}`} checked={selectedApplicantIds.includes(applicant.id)} onChange={() => toggleApplicantSelection(applicant.id)} disabled={applicant.status !== "pending" || Boolean(batchAction) || Boolean(processingApplicantId)} className="h-4 w-4 accent-amber-400 disabled:opacity-30" /></td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-700 bg-slate-800 text-sm font-bold text-slate-300">
                              {applicant.guest_avatar_url ? <img src={applicant.guest_avatar_url} alt={`${applicant.guest_name || "Guest"} profile`} loading="lazy" decoding="async" className="h-full w-full object-cover" /> : (applicant.guest_name || applicant.guest_email || "G").charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-white">{applicant.guest_name || applicant.guest_email?.split("@")[0] || "Name not provided"}</p>
                              <p className="mt-1 text-slate-400">{applicant.guest_email || "Email not provided"}</p>
                              <p className="mt-1 text-slate-400">{applicant.guest_phone || "No phone number"}</p>
                              {applicant.instagram_username && <a href={`https://www.instagram.com/${encodeURIComponent(applicant.instagram_username)}/`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-amber-300 hover:underline">@{applicant.instagram_username}</a>}
                              <p className="mt-1 text-xs capitalize text-slate-500">WhatsApp: {applicant.whatsapp_delivery_status || "not sent"}</p>
                              {applicant.whatsapp_delivery_error && <p className="mt-1 max-w-56 text-xs text-red-300">{applicant.whatsapp_delivery_error}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4"><p className="font-semibold">{applicant.event.title}</p><p className="mt-1 text-slate-400">{locationLabel(applicant.event)}</p></td>
                        <td className="px-4 py-4 capitalize">{applicant.status}{applicant.auto_rejected && <p className="mt-1 text-xs normal-case text-amber-300">Auto-rejected after 24 hours</p>}</td>
                        <td className="px-4 py-4">{applicant.payment_status === "refund_pending" ? "Refund processing" : applicant.payment_status === "refunded" ? "Refunded" : applicant.payment_status.replaceAll("_", " ")}<p className="mt-1 text-slate-400">₹{(applicant.application_fee_paise / 100).toLocaleString("en-IN")}</p></td>
                        <td className="px-4 py-4 text-slate-300">{displayDate(applicant.created_at)}</td>
                        <td className="px-4 py-4 text-slate-300">{displayDate(applicant.checked_in_at)}</td>
                        <td className="px-4 py-4">
                          {applicant.status === "pending" ? (
                            <div className="flex flex-col items-start gap-2">
                            <button
                              type="button"
                              onClick={() => void approveApplicant(applicant)}
                              disabled={Boolean(processingApplicantId) || applicant.payment_status !== "paid"}
                              title={applicant.payment_status !== "paid" ? "Collect the application fee before approval." : undefined}
                              className="whitespace-nowrap rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-black hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60"
                            >
                              {processingApplicantId === applicant.id && processingAction === "approve" ? "Approving..." : applicant.payment_status === "paid" ? "Approve now" : "Awaiting payment"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void rejectApplicant(applicant)}
                              disabled={Boolean(processingApplicantId)}
                              className="whitespace-nowrap rounded-lg border border-red-900 px-3 py-2 text-xs font-semibold text-red-300 hover:border-red-500 disabled:cursor-wait disabled:opacity-60"
                            >
                              {processingApplicantId === applicant.id && processingAction === "reject" ? "Rejecting..." : applicant.payment_status === "paid" ? "Reject & refund" : "Reject"}
                            </button>
                            </div>
                          ) : applicant.status === "approved" && applicant.payment_status === "paid" ? (
                            <button
                              type="button"
                              onClick={() => void sendWhatsAppPass(applicant)}
                              disabled={Boolean(processingApplicantId)}
                              className="whitespace-nowrap rounded-lg border border-amber-500/60 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-400/10 disabled:cursor-wait disabled:opacity-60"
                            >
                              {processingApplicantId === applicant.id && processingAction === "resend" ? "Sending..." : applicant.whatsapp_pass_sent_at ? "Resend pass" : "Send pass"}
                            </button>
                          ) : applicant.status === "rejected" && applicant.payment_status === "paid" ? (
                            <button
                              type="button"
                              onClick={() => void retryRefund(applicant)}
                              disabled={Boolean(processingApplicantId)}
                              className="whitespace-nowrap rounded-lg border border-amber-500/60 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-400/10 disabled:cursor-wait disabled:opacity-60"
                            >
                              {processingApplicantId === applicant.id && processingAction === "refund" ? "Starting refund..." : "Retry refund"}
                            </button>
                          ) : <span className="text-slate-500">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:hidden">
              {filteredApplicants.map((applicant) => (
                <article key={applicant.id} className="rounded-2xl border border-slate-800 bg-[#11141c] p-4">
                  {applicant.status === "pending" && <label className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300"><input type="checkbox" checked={selectedApplicantIds.includes(applicant.id)} onChange={() => toggleApplicantSelection(applicant.id)} disabled={Boolean(batchAction) || Boolean(processingApplicantId)} className="h-4 w-4 accent-amber-400" />Select for batch action</label>}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-700 bg-slate-800 text-sm font-bold text-slate-300">
                        {applicant.guest_avatar_url ? <img src={applicant.guest_avatar_url} alt={`${applicant.guest_name || "Guest"} profile`} loading="lazy" decoding="async" className="h-full w-full object-cover" /> : (applicant.guest_name || applicant.guest_email || "G").charAt(0).toUpperCase()}
                      </div>
                      <h2 className="break-all font-bold">{applicant.guest_name || applicant.guest_email?.split("@")[0] || "Name not provided"}</h2>
                    </div>
                    <span className="rounded-full border border-slate-700 px-3 py-1 text-xs capitalize">{applicant.status}{applicant.auto_rejected ? " · auto-rejected" : ""}</span>
                  </div>
                  <p className="mt-1 break-all text-sm text-slate-400">{applicant.guest_email || "Email not provided"}</p>
                  <p className="mt-1 text-sm text-slate-400">{applicant.guest_phone || "No phone number"}</p>
                  {applicant.instagram_username && <a href={`https://www.instagram.com/${encodeURIComponent(applicant.instagram_username)}/`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm text-amber-300 hover:underline">@{applicant.instagram_username}</a>}
                  <p className="mt-1 text-xs capitalize text-slate-500">WhatsApp pass: {applicant.whatsapp_delivery_status || "not sent"}{applicant.whatsapp_delivery_error ? ` · ${applicant.whatsapp_delivery_error}` : ""}</p>
                  <p className="mt-4 font-semibold">{applicant.event.title}</p>
                  <p className="mt-1 text-sm text-slate-400">{locationLabel(applicant.event)}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div><p className="text-slate-500">Payment</p><p className="mt-1">{applicant.payment_status === "refund_pending" ? "Refund processing" : applicant.payment_status === "refunded" ? "Refunded" : applicant.payment_status.replaceAll("_", " ")} · ₹{(applicant.application_fee_paise / 100).toLocaleString("en-IN")}</p></div>
                    <div><p className="text-slate-500">Applied</p><p className="mt-1">{displayDate(applicant.created_at)}</p></div>
                    <div className="col-span-2"><p className="text-slate-500">Checked in</p><p className="mt-1">{displayDate(applicant.checked_in_at)}</p></div>
                  </div>
                  {applicant.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => void approveApplicant(applicant)}
                      disabled={Boolean(processingApplicantId) || applicant.payment_status !== "paid"}
                      title={applicant.payment_status !== "paid" ? "Collect the application fee before approval." : undefined}
                      className="mt-4 w-full rounded-xl bg-amber-400 px-4 py-3 font-bold text-black hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60"
                    >
                      {processingApplicantId === applicant.id && processingAction === "approve" ? "Approving..." : applicant.payment_status === "paid" ? "Approve now" : "Awaiting payment"}
                    </button>
                  )}
                  {applicant.status === "approved" && applicant.payment_status === "paid" && (
                    <button
                      type="button"
                      onClick={() => void sendWhatsAppPass(applicant)}
                      disabled={Boolean(processingApplicantId)}
                      className="mt-4 w-full rounded-xl border border-amber-500/60 px-4 py-3 font-semibold text-amber-300 hover:bg-amber-400/10 disabled:cursor-wait disabled:opacity-60"
                    >
                      {processingApplicantId === applicant.id && processingAction === "resend" ? "Sending..." : applicant.whatsapp_pass_sent_at ? "Resend WhatsApp pass" : "Send WhatsApp pass"}
                    </button>
                  )}
                  {applicant.status === "rejected" && applicant.payment_status === "paid" && (
                    <button
                      type="button"
                      onClick={() => void retryRefund(applicant)}
                      disabled={Boolean(processingApplicantId)}
                      className="mt-4 w-full rounded-xl border border-amber-500/60 px-4 py-3 font-semibold text-amber-300 hover:bg-amber-400/10 disabled:cursor-wait disabled:opacity-60"
                    >
                      {processingApplicantId === applicant.id && processingAction === "refund" ? "Starting refund..." : "Retry refund"}
                    </button>
                  )}
                  {applicant.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => void rejectApplicant(applicant)}
                      disabled={Boolean(processingApplicantId)}
                      className="mt-2 w-full rounded-xl border border-red-900 px-4 py-3 font-semibold text-red-300 hover:border-red-500 disabled:cursor-wait disabled:opacity-60"
                    >
                      {processingApplicantId === applicant.id && processingAction === "reject" ? "Rejecting..." : applicant.payment_status === "paid" ? "Reject & refund" : "Reject"}
                    </button>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
