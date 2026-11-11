"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SiteHeader from "@/components/site-header";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { hasAccountRole } from "@/lib/account-roles";

type CheckInResult = {
  guest_email: string | null;
  event_title: string;
  checked_in_at: string | null;
  entry_closes_at: string | null;
  requires_override: boolean;
};

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }

  return error instanceof Error ? error.message : "Something went wrong.";
}

export default function OrganizerCheckInPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const processingScan = useRef(false);

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [scannerActive, setScannerActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [scanResult, setScanResult] = useState<CheckInResult | null>(null);
  const [pendingOverrideToken, setPendingOverrideToken] = useState("");

  useEffect(() => {
    let active = true;

    async function checkOrganizerSignIn() {
      const { data, error } = await supabase.auth.getUser();

      if (!active) return;

      if (error || !data.user) {
        router.replace("/organizer/login");
        return;
      }

      if (!hasAccountRole(data.user.user_metadata, "organizer")) {
        router.replace("/organizer/login?error=wrong_account_type");
        return;
      }

      setCheckingAuth(false);
    }

    void checkOrganizerSignIn();

    return () => {
      active = false;
    };
  }, [router, supabase]);

  const handleDecodedQr = useCallback(
    async (decodedText: string, approveAnyway = false) => {
      if (processingScan.current) return;

      processingScan.current = true;
      setScannerActive(false);
      setProcessing(true);
      setCameraMessage("");
      setErrorMessage("");
      setSuccessMessage("");
      if (!approveAnyway) {
        setScanResult(null);
        setPendingOverrideToken("");
      }

      try {
        const token = decodedText.trim();
        const uuidPattern =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (!uuidPattern.test(token)) {
          throw new Error("This QR code is not a Guestora check-in code.");
        }

        const { data, error } = await supabase
          .rpc("check_in_guest_by_token", {
            p_check_in_token: token,
            p_approve_anyway: approveAnyway,
          })
          .single();

        if (error) {
          throw error;
        }

        const result = data as unknown as CheckInResult | null;

        if (!result) {
          throw new Error("The check-in response was empty. Please scan again.");
        }

        setScanResult(result);
        if (result.requires_override) {
          setPendingOverrideToken(token);
          setSuccessMessage("");
        } else {
          setPendingOverrideToken("");
          setSuccessMessage("Guest checked in successfully.");
        }
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
      } finally {
        setProcessing(false);
        processingScan.current = false;
      }
    },
    [supabase]
  );

  useEffect(() => {
    if (!scannerActive) return;

    let cancelled = false;
    let scanner: import("html5-qrcode").Html5Qrcode | null = null;
    let scannerStarted = false;

    async function startScanner() {
      try {
        setCameraMessage("Looking for a camera...");

        const {
          Html5Qrcode,
          Html5QrcodeSupportedFormats,
        } = await import("html5-qrcode");

        if (cancelled) return;

        const cameras = await Html5Qrcode.getCameras();

        if (cancelled) return;

        if (!cameras.length) {
          throw new Error(
            "Chrome did not find a camera. Check that your webcam is connected and selected in Chrome camera settings."
          );
        }

        const selectedCamera =
          cameras.find((camera) =>
            /back|rear|environment/i.test(camera.label)
          ) ?? cameras[0];

        setCameraMessage(
          `Starting camera: ${selectedCamera.label || "available camera"}`
        );

        scanner = new Html5Qrcode("guestora-qr-reader", {
          verbose: false,
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        });

        await scanner.start(
          selectedCamera.id,
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1,
          },
          (decodedText) => {
            void handleDecodedQr(decodedText);
          },
          () => {
            // No QR code has been detected in this frame yet.
          }
        );

        scannerStarted = true;

        if (cancelled) {
          await scanner.stop().catch(() => undefined);
          await scanner.clear();
          return;
        }

        setCameraMessage(
          `Camera is running: ${selectedCamera.label || "available camera"}. Point it at a guest's QR code.`
        );
      } catch (error) {
        if (cancelled) return;

        setScannerActive(false);
        setCameraMessage("");
        setErrorMessage(
          `Could not start the camera scanner: ${getErrorMessage(error)}`
        );

        if (scanner) {
          await scanner.clear();
        }
      }
    }

    void startScanner();

    return () => {
      cancelled = true;

      if (scanner) {
        void (async () => {
          if (scannerStarted) {
            await scanner.stop().catch(() => undefined);
          }

          await scanner.clear();
        })();
      }
    };
  }, [scannerActive, handleDecodedQr]);

  function startScanning() {
    processingScan.current = false;
    setCameraMessage("");
    setErrorMessage("");
    setSuccessMessage("");
    setScanResult(null);
    setPendingOverrideToken("");
    setScannerActive(true);
  }

  function stopScanning() {
    setScannerActive(false);
    setCameraMessage("");
  }

  if (checkingAuth) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080b12] text-white">
        <p className="text-slate-400">Checking your sign-in...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#080b12] text-white">
      <SiteHeader area="organizer" current="check-in" />
      <div className="mx-auto max-w-2xl">
        <section className="mx-5 mt-10 rounded-3xl border border-slate-800 bg-[#11151e] p-7 sm:mx-8 sm:p-10">
          <p className="text-sm font-bold uppercase tracking-[0.25em] text-amber-400">
            Event entrance
          </p>

          <h1 className="mt-3 text-3xl font-black sm:text-4xl">
            Scan guest QR
          </h1>

          <p className="mt-4 leading-7 text-slate-400">
            Sign in with the organizer account for the event. Scan an approved
            guest’s Guestora QR to check them in. Each QR can be used once.
          </p>

          {errorMessage && (
            <p
              role="alert"
              className="mt-6 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300"
            >
              {errorMessage}
            </p>
          )}

          {scanResult?.requires_override && (
            <div
              role="alert"
              className="mt-6 rounded-xl border border-amber-500/50 bg-amber-950/40 p-5 text-amber-100"
            >
              <p className="font-bold">Guest list entry closing time has passed.</p>
              <p className="mt-2">{scanResult.event_title}</p>
              {scanResult.entry_closes_at && (
                <p className="mt-1 text-sm text-amber-200">
                  Entry closed: {new Date(scanResult.entry_closes_at).toLocaleString("en-IN")}
                </p>
              )}
              <p className="mt-3 text-sm">Confirm that you want to allow this guest to enter anyway.</p>
            </div>
          )}

          {successMessage && scanResult && (
            <div
              role="status"
              className="mt-6 rounded-xl border border-emerald-900 bg-emerald-950/30 p-5 text-emerald-300"
            >
              <p className="font-bold">{successMessage}</p>
              <p className="mt-2">Event: {scanResult.event_title}</p>
              <p className="mt-1">
                Guest: {scanResult.guest_email || "Email unavailable"}
              </p>
              <p className="mt-1 text-sm">
                Checked in:{" "}
                {scanResult.checked_in_at
                  ? new Date(scanResult.checked_in_at).toLocaleString("en-IN")
                  : "Just now"}
              </p>
            </div>
          )}

          {scannerActive && (
            <div className="mt-6 w-full min-w-0 rounded-2xl bg-white p-3 sm:p-4">
              <div id="guestora-qr-reader" />
            </div>
          )}

          {cameraMessage && (
            <p className="mt-4 text-center text-sm text-slate-400">
              {cameraMessage}
            </p>
          )}

          <div className="mt-6 space-y-3">
            {pendingOverrideToken ? (
              <>
                <button
                  onClick={() => void handleDecodedQr(pendingOverrideToken, true)}
                  disabled={processing}
                  className="w-full rounded-xl bg-amber-400 px-5 py-4 font-bold text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {processing ? "Approving entry..." : "Approve anyway and check in"}
                </button>
                <button
                  onClick={startScanning}
                  disabled={processing}
                  className="w-full rounded-xl border border-slate-700 px-5 py-3 font-semibold hover:border-amber-400 disabled:opacity-60"
                >
                  Scan a different guest
                </button>
              </>
            ) : !scannerActive ? (
              <button
                onClick={startScanning}
                disabled={processing}
                className="w-full rounded-xl bg-amber-400 px-5 py-4 font-bold text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {processing
                  ? "Checking guest in..."
                  : scanResult
                    ? "Scan next guest"
                    : "Start camera scanner"}
              </button>
            ) : (
              <button
                onClick={stopScanning}
                className="w-full rounded-xl border border-slate-700 px-5 py-4 font-bold hover:border-amber-400"
              >
                Stop scanner
              </button>
            )}
          </div>

          <p className="mt-4 text-center text-xs text-slate-500">
            Camera scanning works on localhost for testing. Event phones will
            need the deployed HTTPS website.
          </p>
        </section>
      </div>
    </main>
  );
}
