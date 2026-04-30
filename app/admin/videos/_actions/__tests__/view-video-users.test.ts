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
    });
    writeAuditMock.mockResolvedValue({ ok: true, id: "audit-row" });

    const result = await viewVideoUsersAction(VALID_VIDEO_UUID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.users).toHaveLength(3);
    expect(writeAuditMock).toHaveBeenCalledTimes(3);
    for (const call of writeAuditMock.mock.calls) {
      const arg = call[1];
      expect(arg.action).toBe("view_video_users");
      expect(arg.resourceType).toBe("video");
      expect(arg.resourceId).toBe(VALID_VIDEO_UUID);
      const metadata = arg.metadata as Record<string, unknown>;
      expect(metadata.video_id).toBe(VALID_VIDEO_UUID);
      expect(typeof metadata.viewed_user_id).toBe("string");
      expect(typeof metadata.cache_hit).toBe("boolean");
    }
  });

  it("audit fail on one user does not prevent others from being audited or returned", async () => {
    getVideoSummariesUsersMock.mockResolvedValue({
      videoId: VALID_VIDEO_UUID,
      users: [
        { userId: "u1", email: "u1@x", emailLookupOk: true, accessedAt: "2026-04-04T00:00:00Z", cacheHit: true },
        { userId: "u2", email: "u2@x", emailLookupOk: true, accessedAt: "2026-04-03T00:00:00Z", cacheHit: false },
      ],
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
