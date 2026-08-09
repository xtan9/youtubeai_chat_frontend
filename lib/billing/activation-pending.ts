"use client";

import { useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  getCheckoutReturnSessionId,
  isCheckoutReturnPath,
} from "./checkout-return";

export const BILLING_ACTIVATION_PENDING_STORAGE_KEY =
  "youtubeai:billing-activation-pending";
export const BILLING_ACTIVATION_OUTCOME_STORAGE_KEY =
  "youtubeai:billing-activation-outcome";
const ACTIVATION_PENDING_EVENT = "youtubeai:billing-activation-pending-change";

export type BillingActivationOutcome = "active" | "invalid";

type StoredOutcome = {
  readonly sessionId: string;
  readonly outcome: BillingActivationOutcome;
};

let hasInMemoryOutcome = false;
let inMemoryOutcome: StoredOutcome | null = null;

export function setBillingActivationPending(sessionId: string | null): void {
  if (typeof window === "undefined") return;

  try {
    if (sessionId) {
      window.sessionStorage.setItem(
        BILLING_ACTIVATION_PENDING_STORAGE_KEY,
        sessionId,
      );
    } else {
      window.sessionStorage.removeItem(BILLING_ACTIVATION_PENDING_STORAGE_KEY);
    }
  } catch {
    // The route guard still prevents an initial duplicate action when browser
    // storage is disabled. This auxiliary signal must never break activation.
  }
  window.dispatchEvent(new Event(ACTIVATION_PENDING_EVENT));
}

export function isBillingActivationPending(): boolean {
  if (typeof window === "undefined") return false;
  let sessionId: string | null;
  try {
    sessionId = window.sessionStorage.getItem(
      BILLING_ACTIVATION_PENDING_STORAGE_KEY,
    );
  } catch {
    return false;
  }
  if (!sessionId || !isCheckoutReturnPath(location.pathname, location.search)) {
    return false;
  }
  return new URLSearchParams(location.search).get("session_id") === sessionId;
}

function readBillingActivationOutcome(): StoredOutcome | null {
  if (typeof window === "undefined") return null;
  if (hasInMemoryOutcome) return inMemoryOutcome;
  try {
    const raw = window.sessionStorage.getItem(
      BILLING_ACTIVATION_OUTCOME_STORAGE_KEY,
    );
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("sessionId" in parsed) ||
      typeof parsed.sessionId !== "string" ||
      !("outcome" in parsed) ||
      (parsed.outcome !== "active" && parsed.outcome !== "invalid")
    ) {
      return null;
    }
    return {
      sessionId: parsed.sessionId,
      outcome: parsed.outcome,
    };
  } catch {
    return null;
  }
}

export function setBillingActivationOutcome(
  sessionId: string,
  outcome: BillingActivationOutcome | null,
): void {
  if (typeof window === "undefined") return;
  hasInMemoryOutcome = true;
  inMemoryOutcome = outcome ? { sessionId, outcome } : null;
  try {
    if (outcome) {
      window.sessionStorage.setItem(
        BILLING_ACTIVATION_OUTCOME_STORAGE_KEY,
        JSON.stringify({ sessionId, outcome } satisfies StoredOutcome),
      );
    } else {
      window.sessionStorage.removeItem(BILLING_ACTIVATION_OUTCOME_STORAGE_KEY);
    }
  } catch {
    // An unavailable optional browser store must not break checkout recovery.
  }
  window.dispatchEvent(new Event(ACTIVATION_PENDING_EVENT));
}

function subscribe(onStoreChange: () => void): () => void {
  const onStorageChange = (event: StorageEvent) => {
    if (event.key === BILLING_ACTIVATION_OUTCOME_STORAGE_KEY) {
      hasInMemoryOutcome = false;
      inMemoryOutcome = null;
    }
    onStoreChange();
  };
  window.addEventListener(ACTIVATION_PENDING_EVENT, onStoreChange);
  window.addEventListener("storage", onStorageChange);
  return () => {
    window.removeEventListener(ACTIVATION_PENDING_EVENT, onStoreChange);
    window.removeEventListener("storage", onStorageChange);
  };
}

export function useBillingActivationPending(): boolean {
  return useSyncExternalStore(
    subscribe,
    isBillingActivationPending,
    () => false,
  );
}

export function useIsCheckoutReturnPath(): boolean {
  return isCheckoutReturnPath(usePathname(), useSearchParams());
}

export function useIsCheckoutReturnPending(): boolean {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sessionId = getCheckoutReturnSessionId(pathname, searchParams);
  return useSyncExternalStore(
    subscribe,
    () => {
      if (!sessionId) return false;
      return readBillingActivationOutcome()?.sessionId !== sessionId;
    },
    // Browser-only terminal state is unavailable during SSR. Conservatively
    // suppress purchase actions for a valid return so the initial HTML cannot
    // flash Pricing or Upgrade before hydration verifies the outcome.
    () => sessionId !== null,
  );
}
