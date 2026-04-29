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

import { viewTranscriptAction } from "../_actions/view-transcript";
import { requireAdminPage } from "@/app/admin/_components/admin-gate";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import { writeAudit } from "@/lib/admin/audit";

const requireAdminPageMock = vi.mocked(requireAdminPage);
const requireAdminClientMock = vi.mocked(requireAdminClient);
const writeAuditMock = vi.mocked(writeAudit);

const VALID_UUID = "11111111-2222-3333-4444-555555555555";
const VALID_VIEWED_USER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

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
  // The action only consumes `client.from(...)`; the rest of the
  // SupabaseClient surface is unused here. Cast through `unknown` keeps
  // strict-mode lint happy without faking a 24-property mock.
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

    const result = await viewTranscriptAction(VALID_UUID, VALID_VIEWED_USER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transcript).toBe("raw transcript text");
    expect(result.summary).toBe("the summary");
    expect(result.thinking).toBe("thoughts");
    expect(result.videoTitle).toBe("Video title");
    expect(result.source).toBe("whisper");
    expect(result.auditId).toBe("audit-row-1");

    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    const auditCall = writeAuditMock.mock.calls[0][1];
    // Exact equality on metadata locks the whitelist: only viewed_user_id
    // is permitted. A future change that adds, say, `summaryTitle` to
    // metadata would fail this assertion — exactly the spike-003 rule.
    expect(auditCall.metadata).toEqual({ viewed_user_id: VALID_VIEWED_USER });
    expect(auditCall.admin).toEqual({
      userId: "admin-uuid",
      email: "alice@example.com",
    });
    expect(auditCall.action).toBe("view_transcript");
    expect(auditCall.resourceType).toBe("summary");
    expect(auditCall.resourceId).toBe(VALID_UUID);
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

    const result = await viewTranscriptAction(VALID_UUID, VALID_VIEWED_USER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transcript).toBe("raw transcript");
    expect(result.auditId).toBeNull();
  });

  it("returns missing_summary_id when summaryId is empty", async () => {
    const result = await viewTranscriptAction("", VALID_VIEWED_USER);
    expect(result.ok).toBe(false);
    expect(requireAdminPageMock).not.toHaveBeenCalled();
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("returns invalid_summary_id when input is non-UUID (defends against injection)", async () => {
    const result = await viewTranscriptAction(
      "not-a-uuid; drop table summaries; --",
      VALID_VIEWED_USER,
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

    const result = await viewTranscriptAction(VALID_UUID, VALID_VIEWED_USER);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("summary_not_found");
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("propagates Next's redirect throw from the gate (no audit, no DB read)", async () => {
    // requireAdminPage doesn't throw a custom NotAdminError — it calls
    // next/navigation's redirect(), which throws an Error tagged with
    // a "NEXT_REDIRECT;…" digest. Reproduce that shape so the test
    // mirrors real gate behavior.
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/;0",
    });
    requireAdminPageMock.mockRejectedValueOnce(redirectError);
    await expect(
      viewTranscriptAction(VALID_UUID, VALID_VIEWED_USER),
    ).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT/) });
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

    const result = await viewTranscriptAction(VALID_UUID, VALID_VIEWED_USER);
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

    const result = await viewTranscriptAction(VALID_UUID, VALID_VIEWED_USER);
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

  it("drops a non-UUID viewedUserId (soft-fail, audit still runs)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = buildSupabaseClient([
      {
        table: "summaries",
        response: {
          data: {
            id: VALID_UUID,
            video_id: "v1",
            transcript: "t",
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

    await viewTranscriptAction(
      VALID_UUID,
      "not-a-uuid'); insert into admin_audit_log…",
    );

    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    expect(writeAuditMock.mock.calls[0][1].metadata).toEqual({});
    expect(warn).toHaveBeenCalled();
  });

  it("surfaces audit failure reason on the response (fail-open with detail)", async () => {
    const client = buildSupabaseClient([
      {
        table: "summaries",
        response: {
          data: {
            id: VALID_UUID,
            video_id: "v1",
            transcript: "t",
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
    writeAuditMock.mockResolvedValue({
      ok: false,
      reason: "connection_timeout",
    });

    const result = await viewTranscriptAction(VALID_UUID, VALID_VIEWED_USER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.auditId).toBeNull();
    expect(result.auditFailureReason).toBe("connection_timeout");
  });

  it("flags videoFetchFailed when the videos join errors (transcript still returned)", async () => {
    const client = buildSupabaseClient([
      {
        table: "summaries",
        response: {
          data: {
            id: VALID_UUID,
            video_id: "v1",
            transcript: "t",
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
      {
        table: "videos",
        response: { data: null, error: { message: "videos table missing" } },
      },
    ]);
    requireAdminClientMock.mockReturnValue(client);
    writeAuditMock.mockResolvedValue({ ok: true, id: "audit-1" });

    const result = await viewTranscriptAction(VALID_UUID, VALID_VIEWED_USER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.videoFetchFailed).toBe(true);
    expect(result.videoTitle).toBeNull();
    // Audit should still fire — video metadata is auxiliary.
    expect(writeAuditMock).toHaveBeenCalledTimes(1);
  });
});
