import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

vi.mock("@/app/admin/_components/admin-gate", () => ({
  requireAdminPage: vi.fn(),
}));

vi.mock("@/lib/supabase/admin-client", () => ({
  requireAdminClient: vi.fn(),
  AdminClientUnavailableError: class extends Error {},
  NotAdminError: class extends Error {},
}));

vi.mock("@/lib/admin/audit", () => ({
  writeAudit: vi.fn(),
}));

vi.mock("@/lib/admin/queries", () => ({
  getVideoSummariesUsers: vi.fn(),
}));

import { viewVideoUsersAction } from "../view-video-users";
import { requireAdminPage } from "@/app/admin/_components/admin-gate";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import { writeAudit } from "@/lib/admin/audit";
import { getVideoSummariesUsers } from "@/lib/admin/queries";

const requireAdminPageMock = vi.mocked(requireAdminPage);
const requireAdminClientMock = vi.mocked(requireAdminClient);
const writeAuditMock = vi.mocked(writeAudit);
const getVideoSummariesUsersMock = vi.mocked(getVideoSummariesUsers);

const VALID_VIDEO_UUID = "11111111-2222-3333-4444-555555555555";

const adminPrincipal = {
  userId: "admin-uuid",
  email: "alice@example.com",
  allowlist: new Set(["alice@example.com"]),
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireAdminPageMock.mockReset();
  requireAdminClientMock.mockReset();
  writeAuditMock.mockReset();
  getVideoSummariesUsersMock.mockReset();
  requireAdminPageMock.mockResolvedValue(adminPrincipal);
  requireAdminClientMock.mockReturnValue({} as unknown as SupabaseClient);
});

describe("viewVideoUsersAction", () => {
  it("writes one audit row per revealed user with viewed_user_id metadata", async () => {
    getVideoSummariesUsersMock.mockResolvedValue({
      videoId: VALID_VIDEO_UUID,
      users: [
        {
          userId: "u1",
          email: "u1@example.com",
          emailLookupOk: true,
          accessedAt: "2026-04-04T00:00:00Z",
          cacheHit: true,
        },
        {
          userId: "u2",
          email: "u2@example.com",
          emailLookupOk: true,
          accessedAt: "2026-04-03T00:00:00Z",
          cacheHit: false,
        },
        {
          userId: "u3",
          email: null,
          emailLookupOk: false,
          accessedAt: "2026-04-02T00:00:00Z",
          cacheHit: true,
        },
      ],
      truncated: false,
    });
    writeAuditMock.mockResolvedValue({ ok: true, id: "audit-row" });

    const result = await viewVideoUsersAction(VALID_VIDEO_UUID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.users).toHaveLength(3);
    expect(result.truncated).toBe(false);
    expect(writeAuditMock).toHaveBeenCalledTimes(3);

    // Security-forensics: the SET of viewed_user_id values written to
    // audit MUST equal the set of revealed user IDs. A closure bug that
    // wrote `viewed_user_id: "u1"` for all three would currently ship
    // green if we only asserted call count + types. Same for cache_hit
    // — each row's value must match the corresponding user's cacheHit.
    const audits = writeAuditMock.mock.calls.map((c) => {
      const arg = c[1];
      const md = arg.metadata as Record<string, unknown>;
      return {
        viewedUserId: md.viewed_user_id as string,
        cacheHit: md.cache_hit as boolean,
        drilldownTruncated: md.drilldown_truncated as boolean,
        action: arg.action,
        resourceType: arg.resourceType,
        resourceId: arg.resourceId,
        videoId: md.video_id as string,
      };
    });
    for (const a of audits) {
      expect(a.action).toBe("view_video_users");
      expect(a.resourceType).toBe("video");
      expect(a.resourceId).toBe(VALID_VIDEO_UUID);
      expect(a.videoId).toBe(VALID_VIDEO_UUID);
      // Forensic reviewers six months out should be able to tell
      // whether this audit row represents the full user set or a
      // 200-cap subset directly from the audit metadata. The fixture
      // returns truncated=false, so every row should record false.
      expect(a.drilldownTruncated).toBe(false);
    }
    expect(audits.map((a) => a.viewedUserId).sort()).toEqual([
      "u1",
      "u2",
      "u3",
    ]);
    // The cache_hit map must align with the input: u1=true, u2=false, u3=true
    const cacheHitByUser = Object.fromEntries(
      audits.map((a) => [a.viewedUserId, a.cacheHit]),
    );
    expect(cacheHitByUser).toEqual({ u1: true, u2: false, u3: true });
  });

  it("does not write audit when drilldown returns zero users", async () => {
    getVideoSummariesUsersMock.mockResolvedValue({
      videoId: VALID_VIDEO_UUID,
      users: [],
      truncated: false,
    });

    const result = await viewVideoUsersAction(VALID_VIDEO_UUID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.users).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("propagates truncated=true from the drilldown query through the action result", async () => {
    // Cap-hit fixture — the action should pass `truncated` through
    // to the wire so the row-expansion UI can surface its banner.
    // A regression that drops this field would silently degrade the
    // operator's ability to know they're not seeing the full user set.
    getVideoSummariesUsersMock.mockResolvedValue({
      videoId: VALID_VIDEO_UUID,
      users: [
        {
          userId: "u1",
          email: "u1@example.com",
          emailLookupOk: true,
          accessedAt: "2026-04-04T00:00:00Z",
          cacheHit: true,
        },
      ],
      truncated: true,
    });
    writeAuditMock.mockResolvedValue({ ok: true, id: "audit-1" });

    const result = await viewVideoUsersAction(VALID_VIDEO_UUID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    // And it must appear on the per-user audit metadata too — the
    // forensic guarantee asserted in commit 2.
    const md = writeAuditMock.mock.calls[0][1].metadata as Record<
      string,
      unknown
    >;
    expect(md.drilldown_truncated).toBe(true);
  });

  it("audit fail on one user does not prevent others from being audited or returned", async () => {
    getVideoSummariesUsersMock.mockResolvedValue({
      videoId: VALID_VIDEO_UUID,
      users: [
        { userId: "u1", email: "u1@x", emailLookupOk: true, accessedAt: "2026-04-04T00:00:00Z", cacheHit: true },
        { userId: "u2", email: "u2@x", emailLookupOk: true, accessedAt: "2026-04-03T00:00:00Z", cacheHit: false },
      ],
      truncated: false,
    });
    let i = 0;
    writeAuditMock.mockImplementation(async () => {
      i++;
      if (i === 1) return { ok: false, reason: "boom" };
      return { ok: true, id: `audit-${i}` };
    });
    const result = await viewVideoUsersAction(VALID_VIDEO_UUID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.users).toHaveLength(2);
    // First user has auditId=null, second has the audit row id
    expect(result.users[0].auditId).toBeNull();
    expect(result.users[1].auditId).toBe("audit-2");
  });

  it("returns missing_video_id for empty input", async () => {
    const result = await viewVideoUsersAction("");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing_video_id");
  });

  it("returns invalid_video_id for non-UUID input", async () => {
    const result = await viewVideoUsersAction("not-a-uuid");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_video_id");
  });

  it("returns internal_error when drilldown query throws", async () => {
    getVideoSummariesUsersMock.mockRejectedValue(new Error("db down"));
    const result = await viewVideoUsersAction(VALID_VIDEO_UUID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("internal_error");
  });
});
