import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { viewTranscriptAction } from "../_actions/view-transcript";
import { requireAdminPage } from "@/app/admin/_components/admin-gate";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import { writeAudit } from "@/lib/admin/audit";

const requireAdminPageMock = vi.mocked(requireAdminPage);
const requireAdminClientMock = vi.mocked(requireAdminClient);
const writeAuditMock = vi.mocked(writeAudit);

const VALID_UUID = "11111111-2222-3333-4444-555555555555";

interface ChainResponse {
  data: unknown;
  error: unknown;
}

interface ChainScript {
  table: string;
  response: ChainResponse;
}

function buildSupabaseClient(scripts: ChainScript[]) {
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
    proxy.maybeSingle = term;
    proxy.single = term;
    return proxy;
  });
  return { from };
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

describe("viewTranscriptAction", () => {
  it("returns content + writes audit when admin views a known summary", async () => {
    const client = buildSupabaseClient([
      {
        table: "summaries",
        response: {
          data: {
            id: VALID_UUID,
            video_id: "v1",
            transcript: "raw transcript text",
            summary: "the summary",
            thinking: "thoughts",
            transcript_source: "whisper",
            model: "claude-opus-4-7",
            processing_time_seconds: 12.5,
            created_at: "2026-04-29T10:00:00Z",
          },
          error: null,
        },
      },
      {
        table: "videos",
        response: {
          data: {
            title: "Video title",
            channel_name: "Channel",
            language: "en",
          },
          error: null,
        },
      },
    ]);
    requireAdminClientMock.mockReturnValue(client);
    writeAuditMock.mockResolvedValue({ ok: true, id: "audit-row-1" });

    const result = await viewTranscriptAction(VALID_UUID, "user-uuid");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transcript).toBe("raw transcript text");
    expect(result.summary).toBe("the summary");
    expect(result.thinking).toBe("thoughts");
    expect(result.videoTitle).toBe("Video title");
    expect(result.source).toBe("whisper");
    expect(result.auditId).toBe("audit-row-1");

    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    expect(writeAuditMock).toHaveBeenCalledWith(client, {
      admin: { userId: "admin-uuid", email: "alice@example.com" },
      action: "view_transcript",
      resourceType: "summary",
      resourceId: VALID_UUID,
      metadata: { viewed_user_id: "user-uuid" },
    });
  });

  it("returns content with auditId=null when audit write fails (fail-open)", async () => {
    const client = buildSupabaseClient([
      {
        table: "summaries",
        response: {
          data: {
            id: VALID_UUID,
            video_id: "v1",
            transcript: "raw transcript",
            summary: "summary",
            thinking: null,
            transcript_source: "auto_captions",
            model: "claude-haiku-4-5",
            processing_time_seconds: 5,
            created_at: "2026-04-29T10:00:00Z",
          },
          error: null,
        },
      },
      {
        table: "videos",
        response: { data: null, error: null },
      },
    ]);
    requireAdminClientMock.mockReturnValue(client);
    writeAuditMock.mockResolvedValue({ ok: false, reason: "DB error" });

    const result = await viewTranscriptAction(VALID_UUID, "user-uuid");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transcript).toBe("raw transcript");
    expect(result.auditId).toBeNull();
  });

  it("returns missing_summary_id when summaryId is empty", async () => {
    const result = await viewTranscriptAction("", "user-uuid");
    expect(result.ok).toBe(false);
    expect(requireAdminPageMock).not.toHaveBeenCalled();
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("returns invalid_summary_id when input is non-UUID (defends against injection)", async () => {
    const result = await viewTranscriptAction(
      "not-a-uuid; drop table summaries; --",
      "user-uuid",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_summary_id");
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("returns summary_not_found when DB has no row for the id (no audit write)", async () => {
    const client = buildSupabaseClient([
      {
        table: "summaries",
        response: { data: null, error: null },
      },
    ]);
    requireAdminClientMock.mockReturnValue(client);

    const result = await viewTranscriptAction(VALID_UUID, "user-uuid");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("summary_not_found");
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("propagates NotAdminError from the gate (no audit, no DB read)", async () => {
    const NotAdminError = class extends Error {
      name = "NotAdminError";
    };
    requireAdminPageMock.mockRejectedValueOnce(new NotAdminError("denied"));
    await expect(
      viewTranscriptAction(VALID_UUID, "user-uuid"),
    ).rejects.toThrow("denied");
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("returns internal_error and skips audit when summaries fetch errors", async () => {
    const client = buildSupabaseClient([
      {
        table: "summaries",
        response: { data: null, error: { message: "table missing" } },
      },
    ]);
    requireAdminClientMock.mockReturnValue(client);

    const result = await viewTranscriptAction(VALID_UUID, "user-uuid");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("internal_error");
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("treats unknown transcript_source as internal_error (defense in depth)", async () => {
    const client = buildSupabaseClient([
      {
        table: "summaries",
        response: {
          data: {
            id: VALID_UUID,
            video_id: "v1",
            transcript: "raw",
            summary: "s",
            thinking: null,
            transcript_source: "unknown_future_source",
            model: "claude-haiku-4-5",
            processing_time_seconds: 5,
            created_at: "2026-04-29T10:00:00Z",
          },
          error: null,
        },
      },
    ]);
    requireAdminClientMock.mockReturnValue(client);

    const result = await viewTranscriptAction(VALID_UUID, "user-uuid");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("internal_error");
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("omits viewed_user_id from metadata when caller passes null", async () => {
    const client = buildSupabaseClient([
      {
        table: "summaries",
        response: {
          data: {
            id: VALID_UUID,
            video_id: "v1",
            transcript: null,
            summary: "s",
            thinking: null,
            transcript_source: "auto_captions",
            model: null,
            processing_time_seconds: null,
            created_at: "2026-04-29T10:00:00Z",
          },
          error: null,
        },
      },
      { table: "videos", response: { data: null, error: null } },
    ]);
    requireAdminClientMock.mockReturnValue(client);
    writeAuditMock.mockResolvedValue({ ok: true, id: "a" });

    await viewTranscriptAction(VALID_UUID, null);

    expect(writeAuditMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ metadata: {} }),
    );
  });
});
