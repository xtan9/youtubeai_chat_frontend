import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "../relative-time";

const NOW = new Date("2026-04-28T12:00:00Z").getTime();

describe("formatRelativeTime", () => {
  it("returns 'just now' for less than a minute ago", () => {
    expect(formatRelativeTime("2026-04-28T11:59:30Z", NOW)).toBe("just now");
  });

  it("returns minutes for under an hour", () => {
    expect(formatRelativeTime("2026-04-28T11:55:00Z", NOW)).toBe(
      "5 minutes ago",
    );
  });

  it("returns hours for under a day", () => {
    expect(formatRelativeTime("2026-04-28T09:00:00Z", NOW)).toBe(
      "3 hours ago",
    );
  });

  it("returns days for under a week", () => {
    expect(formatRelativeTime("2026-04-25T12:00:00Z", NOW)).toBe(
      "3 days ago",
    );
  });

  it("returns weeks for under a month", () => {
    expect(formatRelativeTime("2026-04-14T12:00:00Z", NOW)).toBe(
      "2 weeks ago",
    );
  });

  it("returns months for under a year", () => {
    expect(formatRelativeTime("2026-01-28T12:00:00Z", NOW)).toBe(
      "3 months ago",
    );
  });

  it("returns years for over a year", () => {
    expect(formatRelativeTime("2024-04-28T12:00:00Z", NOW)).toBe(
      "2 years ago",
    );
  });

  it("singularizes 1-unit values", () => {
    expect(formatRelativeTime("2026-04-28T11:00:00Z", NOW)).toBe(
      "1 hour ago",
    );
  });

  it("returns 'unknown date' for invalid timestamps", () => {
    expect(formatRelativeTime("not-a-date", NOW)).toBe("unknown date");
  });

  it("clamps future timestamps to 'just now'", () => {
    expect(formatRelativeTime("2026-04-29T00:00:00Z", NOW)).toBe("just now");
  });

  it("returns '1 minute ago' at the exact 60-second boundary", () => {
    expect(formatRelativeTime("2026-04-28T11:59:00Z", NOW)).toBe(
      "1 minute ago",
    );
  });

  it("returns '1 week ago' at exactly 7 days", () => {
    expect(formatRelativeTime("2026-04-21T12:00:00Z", NOW)).toBe(
      "1 week ago",
    );
  });
});
