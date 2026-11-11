"use client";

import { useState } from "react";

export default function ClaimDashboardButton({ token }: { token: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function openDashboard() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/guest/dashboard/access/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "This dashboard link is invalid or has been replaced.");
      window.location.replace("/dashboard");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This dashboard link is invalid or has been replaced.");
      setLoading(false);
    }
  }

  return <>
    {error && <p role="alert" className="mt-5 rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}
    <button type="button" onClick={() => void openDashboard()} disabled={loading} className="mt-7 w-full rounded-xl bg-amber-400 px-5 py-4 font-bold text-black hover:bg-amber-300 disabled:opacity-60">
      {loading ? "Opening dashboard..." : "Continue to dashboard"}
    </button>
  </>;
}
