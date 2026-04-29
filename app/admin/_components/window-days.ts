/** Parse `?window=N` from a search-params string into an allowlisted
 * window-days value. Returns 30 (the default) for any input outside the
 * allowlist — including NaN, negative numbers, and oversized values an
 * attacker might pass to widen a query. */
export function parseWindowDays(
  raw: string | undefined,
  allowed: readonly number[] = [7, 14, 30, 90],
): number {
  const set = new Set(allowed);
  const n = raw ? Number.parseInt(raw, 10) : 30;
  return set.has(n) ? n : 30;
}
