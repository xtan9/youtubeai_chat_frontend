export const DEFAULT_AUTH_REDIRECT = "/dashboard";

// A synthetic origin lets URL validate unusual relative forms (for example,
// a backslash-prefixed host) without ever trusting the caller's origin.
const REDIRECT_VALIDATION_ORIGIN = "https://auth-redirect.invalid";

export function normalizeAuthRedirect(
  value: string | null | undefined,
): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_AUTH_REDIRECT;
  }

  try {
    const parsed = new URL(value, REDIRECT_VALIDATION_ORIGIN);
    if (parsed.origin !== REDIRECT_VALIDATION_ORIGIN) {
      return DEFAULT_AUTH_REDIRECT;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_AUTH_REDIRECT;
  }
}

export function getSafeAuthRedirect(currentUrl: string): string {
  try {
    const redirectTo = new URL(currentUrl).searchParams.get("redirect_to");
    return normalizeAuthRedirect(redirectTo);
  } catch {
    return DEFAULT_AUTH_REDIRECT;
  }
}

export function buildAuthCallbackUrl(origin: string, next: string): string {
  const callbackUrl = new URL("/auth/callback", origin);
  callbackUrl.searchParams.set("next", normalizeAuthRedirect(next));
  return callbackUrl.toString();
}
