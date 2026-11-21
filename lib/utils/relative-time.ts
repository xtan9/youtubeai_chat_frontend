const UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
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
  locale = "en",
): string {
  const then = new Date(iso).getTime();
  // Distinct from "just now" so a corrupted/missing timestamp surfaces in the
  // UI (and in monitoring) instead of masquerading as a fresh row.
  if (Number.isNaN(then)) return locale === "en" ? "unknown date" : "日期不明";
  const diffSec = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (diffSec < 60) return locale === "en" ? "just now" : locale === "zh-TW" ? "剛剛" : "刚刚";
  for (const { unit, seconds } of UNITS) {
    if (diffSec >= seconds) {
      const value = Math.floor(diffSec / seconds);
      return new Intl.RelativeTimeFormat(locale).format(-value, unit);
    }
  }
  return locale === "en" ? "just now" : locale === "zh-TW" ? "剛剛" : "刚刚";
}
