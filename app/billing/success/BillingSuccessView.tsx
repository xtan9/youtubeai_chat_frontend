"use client";

import {useTranslations} from "next-intl";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClockAlert, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  setBillingActivationOutcome,
  setBillingActivationPending,
} from "@/lib/billing/activation-pending";

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 30_000;

type Phase = "active" | "checking" | "invalid" | "polling" | "timeout";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isActiveResponse(value: unknown): value is { status: "active" } {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    value.status === "active"
  );
}

function isPendingResponse(value: unknown): value is { status: "pending" } {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    value.status === "pending"
  );
}

export function BillingSuccessView({
  sessionId,
}: {
  sessionId: string | null;
}) {
  const t = useTranslations("pricing");
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>(
    sessionId ? "checking" : "invalid",
  );
  const [pollCycle, setPollCycle] = useState(0);

  useEffect(
    () => () => {
      setBillingActivationPending(null);
    },
    [],
  );

  useEffect(() => {
    if (!sessionId) {
      setBillingActivationPending(null);
      return;
    }
    setBillingActivationOutcome(sessionId, null);

    const controller = new AbortController();
    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = () => {
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      clearTimeout(timeoutTimer);
    };

    const finish = (nextPhase: "active" | "invalid" | "timeout") => {
      if (stopped) return;
      stopped = true;
      clearTimers();
      if (nextPhase !== "timeout") {
        setBillingActivationPending(null);
        setBillingActivationOutcome(sessionId, nextPhase);
      }
      setPhase(nextPhase);
    };

    const timeoutTimer = setTimeout(() => {
      if (stopped) return;
      stopped = true;
      clearTimers();
      controller.abort();
      setPhase("timeout");
    }, POLL_TIMEOUT_MS);

    const tick = async () => {
      if (stopped) return;
      try {
        const response = await fetch(
          `/api/billing/checkout/status?session_id=${encodeURIComponent(sessionId)}`,
          { cache: "no-store", signal: controller.signal },
        );

        if ([400, 401, 403, 404, 409].includes(response.status)) {
          finish("invalid");
          return;
        }
        if (response.status === 429) {
          // The endpoint's Retry-After exceeds this page's bounded polling
          // window. Stop now and offer the same safe refresh/support recovery
          // instead of hammering Stripe through a two-second retry loop.
          finish("timeout");
          return;
        }

        if (response.ok) {
          const body: unknown = await response.json();
          if (isActiveResponse(body)) {
            finish("active");
            void queryClient.invalidateQueries({
              queryKey: ["entitlements"],
            });
            return;
          }
          if (isPendingResponse(body)) {
            setBillingActivationPending(sessionId);
            setPhase("polling");
          }
        } else {
          console.error("[billing/success] activation status non-ok", {
            errorId: "BILLING_SUCCESS_STATUS_NON_OK",
            status: response.status,
          });
        }
      } catch (error) {
        if (stopped || isAbortError(error)) return;
        console.error("[billing/success] activation status threw", {
          errorId: "BILLING_SUCCESS_STATUS_THREW",
          error,
        });
      }

      if (!stopped) {
        pollTimer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
      }
    };

    void tick();

    return () => {
      stopped = true;
      clearTimers();
      controller.abort();
    };
  }, [pollCycle, queryClient, sessionId]);

  const refreshStatus = () => {
    setPhase("checking");
    setPollCycle((cycle) => cycle + 1);
  };

  return (
    <div className="container mx-auto max-w-lg px-4 py-16 text-center">
      {phase === "checking" ? (
        <section role="status" aria-live="polite" aria-busy="true">
          <LoaderCircle
            aria-hidden="true"
            className="mx-auto size-10 animate-spin text-accent-brand motion-reduce:animate-none"
          />
          <h1 className="mt-5 text-h2 text-text-primary">{t("verifying")}</h1>
          <p className="mt-4 text-body-md text-text-secondary">{t("matching")}</p>
        </section>
      ) : null}

      {phase === "polling" ? (
        <section role="status" aria-live="polite" aria-busy="true">
          <LoaderCircle
            aria-hidden="true"
            className="mx-auto size-10 animate-spin text-accent-brand motion-reduce:animate-none"
          />
          <h1 className="mt-5 text-h2 text-text-primary">{t("activating")}</h1>
          <p className="mt-4 text-body-md text-text-secondary">{t("waiting")}</p>
          <p className="mt-3 text-body-sm text-text-muted">{t("keepOpen")}</p>
        </section>
      ) : null}

      {phase === "active" ? (
        <section role="status" aria-live="polite">
          <CheckCircle2
            aria-hidden="true"
            className="mx-auto size-10 text-accent-success"
          />
          <h1 className="mt-5 text-h2 text-text-primary">{t("activated")}</h1>
          <p className="mt-4 text-body-md text-text-secondary">{t("confirmed")}</p>
          <Button asChild className="mt-6">
            <Link href="/account/billing">{t("viewBilling")}</Link>
          </Button>
        </section>
      ) : null}

      {phase === "timeout" ? (
        <section role="status" aria-live="polite">
          <ClockAlert
            aria-hidden="true"
            className="mx-auto size-10 text-accent-warning"
          />
          <h1 className="mt-5 text-h2 text-text-primary">{t("delayed")}</h1>
          <p className="mt-4 text-body-md text-text-secondary">{t("delayHint")}</p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              type="button"
              onClick={refreshStatus}
            >{t("refreshActivation")}</Button>
            <Button asChild variant="outline">
              <a href="mailto:support@youtubeai.chat?subject=Pro%20activation%20help">{t("support")}</a>
            </Button>
          </div>
        </section>
      ) : null}

      {phase === "invalid" ? (
        <section role="alert">
          <ClockAlert
            aria-hidden="true"
            className="mx-auto size-10 text-accent-warning"
          />
          <h1 className="mt-5 text-h2 text-text-primary">{t("invalid")}</h1>
          <p className="mt-4 text-body-md text-text-secondary">{t("invalidHint")}</p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild>
              <Link href="/account/billing">{t("viewBilling")}</Link>
            </Button>
            <Button asChild variant="outline">
              <a href="mailto:support@youtubeai.chat?subject=Checkout%20return%20help">{t("support")}</a>
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
