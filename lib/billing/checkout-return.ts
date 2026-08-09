export const STRIPE_CHECKOUT_SESSION_ID_PATTERN =
  /^cs_(?:test|live)_[A-Za-z0-9_]+$/;

export function isStripeCheckoutSessionId(value: string): boolean {
  return (
    value.length <= 255 && STRIPE_CHECKOUT_SESSION_ID_PATTERN.test(value)
  );
}

/**
 * Synchronous route guard for global purchase controls. It protects the first
 * checkout-return render before the status endpoint can verify webhook lag.
 */
export function isCheckoutReturnPath(
  pathname: string,
  search: string | Pick<URLSearchParams, "getAll">,
): boolean {
  return getCheckoutReturnSessionId(pathname, search) !== null;
}

export function getCheckoutReturnSessionId(
  pathname: string,
  search: string | Pick<URLSearchParams, "getAll">,
): string | null {
  if (pathname !== "/billing/success" && pathname !== "/billing/success/") {
    return null;
  }

  const params =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : search;
  const sessionIds = params.getAll("session_id");
  if (sessionIds.length !== 1) return null;
  const sessionId = sessionIds[0]?.trim() ?? "";
  return isStripeCheckoutSessionId(sessionId) ? sessionId : null;
}
