export const DEFAULT_REPORT_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

export type TimeWindow = { start: Date; end: Date };

export function lastNDays(windowDays: number): TimeWindow {
  const days = Number.isFinite(windowDays) && windowDays > 0
    ? Math.max(1, Math.floor(windowDays))
    : DEFAULT_REPORT_WINDOW_DAYS;
  const end = new Date();
  const start = new Date(end);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start, end };
}

export function comparisonWindow(window: TimeWindow): TimeWindow {
  // Preserve the reports' existing elapsed-window comparison, including
  // its partial-day rounding and previous end at the preceding midnight.
  const days = Math.round((window.end.getTime() - window.start.getTime()) / DAY_MS) + 1;
  return {
    start: new Date(window.start.getTime() - days * DAY_MS),
    end: new Date(window.start.getTime() - DAY_MS),
  };
}

export function serializeWindow(window: TimeWindow): { start: string; end: string } {
  return { start: window.start.toISOString(), end: window.end.toISOString() };
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function fillDailySeries(
  start: Date,
  end: Date,
  bucketed: Map<string, number>,
): { day: string; value: number }[] {
  const points: { day: string; value: number }[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = isoDay(cursor);
    points.push({ day, value: bucketed.get(day) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return points;
}
