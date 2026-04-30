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

import { viewVideoSummaryAction } from "../view-video-summary";
import { requireAdminPage } from "@/app/admin/_components/admin-gate";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import { writeAudit } from "@/lib/admin/audit";

const requireAdminPageMock = vi.mocked(requireAdminPage);
const requireAdminClientMock = vi.mocked(requireAdminClient);
const writeAuditMock = vi.mocked(writeAudit);

const VALID_VIDEO_UUID = "11111111-2222-3333-4444-555555555555";
const VALID_SUMMARY_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

interface ChainScript {
  table: string;
  response: { data: unknown; error: unknown };
}

function buildSupabaseClient(scripts: ChainScript[]): SupabaseClient {
  let i = 0;
  const from = vi.fn((table: string) => {
    const script = scripts[i++];
    if (!script) {
      throw new Error(`unexpected from('${table}') — no script remaining`);
    }
    if (script.table !== table) {
      throw new Error(
        `expected from('${script.table}'), got from('${table}')`,
      );
    }
    const proxy: Record<string, unknown> = {};
    const term = () => Promise.resolve(script.response);
    proxy.select = () => proxy;
    proxy.eq = () => proxy;
    proxy.order = () => proxy;
    proxy.limit = () => proxy;
    proxy.maybeSingle = term;
    proxy.single = term;
    return proxy;
  });
  return { from } as unknown as SupabaseClient;
}

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
  requireAdminPageMock.mockResolvedValue(adminPrincipal);
});

describe("viewVideoSummaryAction", () => {
  it("returns canonical summary text and writes audit row", async () => {
    const client = buildSupabaseClient([
      {
        // canonical lookup (enable_thinking=false)
        table: "summaries",
        response: {
          data: {
            id: VALID_SUMMARY_UUID,
            video_id: VALID_VIDEO_UUID,
            summary: "the summary",
            thinking: null,
            model: "claude-opus-4-7",
            enable_thinking: false,
            created_at: "2026-04-01T00:00:00Z",
          },
          error: null,
        },
      },
    ]);
    requireAdminClientMock.mockReturnValue(client);
    writeAuditMock.mockResolvedValue({ ok: true, id: "audit-1" });

    const result = await viewVideoSummaryAction(VALID_VIDEO_UUID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toBe("the summary");
    expect(result.summaryId).toBe(VALID_SUMMARY_UUID);
    expect(result.auditId).toBe("audit-1");
    expect(result.auditFailureReason).toBeNull();

    const auditCall = writeAuditMock.mock.calls[0][1];
    expect(auditCall.action).toBe("view_summary_text");
    expect(auditCall.resourceType).toBe("summary");
    expect(auditCall.resourceId).toBe(VALID_SUMMARY_UUID);
    expect(auditCall.metadata).toEqual({
      video_id: VALID_VIDEO_UUID,
      model: "claude-opus-4-7",
      enable_thinking: false,
    });
  });

  it("falls back to most recent summary when no canonical exists", async () => {
    const client = buildSupabaseClient([
      // canonical lookup → no row
      { table: "summaries", response: { data: null, error: null } },
      // fallback lookup → returns the thinking-enabled variant
      {
        table: "summaries",
        response: {
          data: {
            id: VALID_SUMMARY_UUID,
            video_id: VALID_VIDEO_UUID,
            summary: "fallback summary",
            thinking: "raw thoughts",
            model: "claude-opus-4-7",
            enable_thinking: true,
            created_at: "2026-04-02T00:00:00Z",
          },
          error: null,
        },
      },
    ]);
    requireAdminClientMock.mockReturnValue(client);
    writeAuditMock.mockResolvedValue({ ok: true, id: "audit-2" });

    const result = await viewVideoSummaryAction(VALID_VIDEO_UUID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toBe("fallback summary");
    expect(result.thinking).toBe("raw thoughts");
  });

  it("returns video_not_found when no summary exists at all", async () => {
    const client = buildSupabaseClient([
      { table: "summaries", response: { data: null, error: null } },
      { table: "summaries", response: { data: null, error: null } },
    ]);
    requireAdminClientMock.mockReturnValue(client);
    const result = await viewVideoSummaryAction(VALID_VIDEO_UUID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("video_not_found");
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("returns invalid_video_id for non-UUID input", async () => {
    const result = await viewVideoSummaryAction("not-a-uuid");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_video_id");
  });

  it("returns missing_video_id for empty input", async () => {
    const result = await viewVideoSummaryAction("");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing_video_id");
  });

  it("fails open: returns content when audit write rejects", async () => {
    const client = buildSupabaseClient([
      {
        table: "summaries",
        response: {
          data: {
            id: VALID_SUMMARY_UUID,
            video_id: VALID_VIDEO_UUID,
            summary: "the summary",
            thinking: null,
            model: "claude-opus-4-7",
            enable_thinking: false,
            created_at: "2026-04-01T00:00:00Z",
          },
          error: null,
        },
      },
    ]);
    requireAdminClientMock.mockReturnValue(client);
    writeAuditMock.mockResolvedValue({ ok: false, reason: "audit-down" });
    const result = await viewVideoSummaryAction(VALID_VIDEO_UUID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toBe("the summary");
    expect(result.auditId).toBeNull();
    expect(result.auditFailureReason).toBe("audit-down");
  });
});
