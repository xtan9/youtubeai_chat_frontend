"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;

export default function BillingSuccessPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<"polling" | "ok" | "timeout">("polling");

  useEffect(() => {
    const startedAt = Date.now();
    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let redirectTimer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (stopped) return;
      try {
        const res = await fetch("/api/me/entitlements", { cache: "no-store" });
        if (!res.ok) {
          console.error("[billing/success] entitlements non-ok during poll", {
            errorId: "BILLING_SUCCESS_POLL_NON_OK",
            status: res.status,
          });
        }
        if (res.ok) {
          const body = await res.json();
          if (body?.tier === "pro") {
            // Invalidate the cached entitlements query so any other
            // component subscribing via useEntitlements() re-fetches
            // and sees pro immediately, instead of waiting for the
            // 30s staleTime or a window refocus.
            qc.invalidateQueries({ queryKey: ["entitlements"] });
            setPhase("ok");
            // Brief celebratory pause then return home. Guarded so unmount
            // during this 1.5s window doesn't yank the user back to /.
            redirectTimer = setTimeout(() => {
              if (!stopped) router.replace("/");
            }, 1500);
            return;
          }
        }
      } catch (err) {
        console.error("[billing/success] entitlements poll threw", {
          errorId: "BILLING_SUCCESS_POLL_THREW",
          err,
        });
      }
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setPhase("timeout");
        return;
      }
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    tick();

    return () => {
      stopped = true;
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      if (redirectTimer !== undefined) clearTimeout(redirectTimer);
    };
  }, [router, qc]);

  return (
    <main className="container mx-auto max-w-md px-4 py-16 text-center">
      {phase === "polling" && (
        <>
          <h1 className="text-h2 text-text-primary">Confirming your subscription…</h1>
          <p className="mt-4 text-body-md text-text-secondary">
            One moment — we&apos;re activating Pro on your account.
          </p>
        </>
      )}
      {phase === "ok" && (
        <>
          <h1 className="text-h2 text-text-primary">Welcome to Pro!</h1>
          <p className="mt-4 text-body-md text-text-secondary">
            Unlimited summaries, chat, and history are now unlocked.
          </p>
        </>
      )}
      {phase === "timeout" && (
        <>
          <h1 className="text-h2 text-text-primary">Almost done</h1>
          <p className="mt-4 text-body-md text-text-secondary">
            Your subscription is still processing. Please refresh in a moment.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block text-accent-brand hover:underline"
          >
            Back to summaries
          </Link>
        </>
      )}
    </main>
  );
}
