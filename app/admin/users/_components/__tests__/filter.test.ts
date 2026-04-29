import { describe, it, expect } from "vitest";

import { applyUsersFilter } from "../filter";
import type { AdminUserRow } from "@/lib/admin/queries";

const baseRow = (over: Partial<AdminUserRow>): AdminUserRow => ({
  userId: "u",
  email: "u@x",
  createdAt: "2026-01-01",
  lastSeen: null,
  summaries: 0,
  whisper: 0,
  whisperPct: 0,
  p95Seconds: null,
  flagged: false,
  ...over,
});

describe("applyUsersFilter", () => {
  it("returns all rows for 'all' or unknown filter", () => {
    const rows = [baseRow({ userId: "a" }), baseRow({ userId: "b" })];
    expect(applyUsersFilter(rows, "all")).toEqual(rows);
    expect(applyUsersFilter(rows, "unrecognized")).toEqual(rows);
  });

  it("'flagged' keeps only rows where flagged=true", () => {
    const rows = [
      baseRow({ userId: "a", flagged: true }),
      baseRow({ userId: "b", flagged: false }),
      baseRow({ userId: "c", flagged: true }),
    ];
    const out = applyUsersFilter(rows, "flagged");
    expect(out.map((r) => r.userId)).toEqual(["a", "c"]);
  });

  it("'active' keeps only rows with summaries > 0", () => {
    const rows = [
      baseRow({ userId: "a", summaries: 0 }),
      baseRow({ userId: "b", summaries: 5 }),
      baseRow({ userId: "c", summaries: 1 }),
    ];
    const out = applyUsersFilter(rows, "active");
    expect(out.map((r) => r.userId)).toEqual(["b", "c"]);
  });
});
