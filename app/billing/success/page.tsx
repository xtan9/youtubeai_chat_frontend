"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;

export default function BillingSuccessPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"polling" | "ok" | "timeout">("polling");

  useEffect(() => {
    const startedAt = Date.now();
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      try {
        const res = await fetch("/api/me/entitlements", { cache: "no-store" });
        if (res.ok) {
          const body = await res.json();
          if (body?.tier === "pro") {
            setPhase("ok");
            // Brief celebratory pause then return home
            setTimeout(() => router.replace("/"), 1500);
            return;
          }
        }
      } catch {
        // ignore — try again on next tick
      }
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setPhase("timeout");
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };

    tick();
    return () => {
      stopped = true;
    };
  }, [router]);

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
