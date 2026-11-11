"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";

const providers = [
  { id: "google", label: "Google", mark: "G" },
  { id: "facebook", label: "Facebook", mark: "f" },
  { id: "apple", label: "Apple", mark: "●" },
] as const;

export default function SocialAuthButtons({
  next,
  audience,
  initialError = "",
}: {
  next: string;
  audience: "guest" | "organizer";
  initialError?: string;
}) {
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [error, setError] = useState(initialError);

  async function signIn(provider: (typeof providers)[number]["id"]) {
    setLoadingProvider(provider);
    setError("");
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", next);
    callback.searchParams.set("audience", audience);
    try {
      // Preserve intent if Supabase falls back to the site root and strips
      // the callback query parameters from its redirect URL.
      const intentResponse = await fetch("/api/auth/workspace-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience, next }),
      });
      if (!intentResponse.ok) throw new Error("Could not start the selected sign-in flow. Please try again.");
      const { error: authError } = await createClient().auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: callback.toString(),
          queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
        },
      });
      if (authError) throw authError;
    } catch (caught) {
      await fetch("/api/auth/workspace-intent", { method: "DELETE" }).catch(() => undefined);
      const reason = caught instanceof Error ? `: ${caught.message}` : ". Please try again.";
      setError(`${providers.find((item) => item.id === provider)?.label} sign-in could not start${reason}`);
      setLoadingProvider(null);
    }
  }

  return (
    <div className="mt-6 space-y-3">
      {providers.map((provider) => (
        <button
          key={provider.id}
          type="button"
          onClick={() => void signIn(provider.id)}
          disabled={Boolean(loadingProvider)}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-700 bg-[#080b12] px-5 py-3 font-semibold text-white transition hover:border-amber-400 disabled:opacity-60"
        >
          <span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-sm font-black text-slate-900">{provider.mark}</span>
          {loadingProvider === provider.id ? `Opening ${provider.label}...` : `Continue with ${provider.label}`}
        </button>
      ))}
      {error && <p role="alert" className="rounded-xl bg-red-950 p-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
