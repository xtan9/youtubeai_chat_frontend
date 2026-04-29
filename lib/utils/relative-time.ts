const UNITS: Array<{ unit: string; seconds: number }> = [
  { unit: "year", seconds: 60 * 60 * 24 * 365 },
  { unit: "month", seconds: 60 * 60 * 24 * 30 },
  { unit: "week", seconds: 60 * 60 * 24 * 7 },
  { unit: "day", seconds: 60 * 60 * 24 },
  { unit: "hour", seconds: 60 * 60 },
  { unit: "minute", seconds: 60 },
];

export function formatRelativeTime(
  iso: string,
  nowMs: number = Date.now(),
): string {
  const then = new Date(iso).getTime();
  // Distinct from "just now" so a corrupted/missing timestamp surfaces in the
  // UI (and in monitoring) instead of masquerading as a fresh row.
  if (Number.isNaN(then)) return "unknown date";
  const diffSec = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (diffSec < 60) return "just now";
  for (const { unit, seconds } of UNITS) {
    if (diffSec >= seconds) {
      const value = Math.floor(diffSec / seconds);
      return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}
