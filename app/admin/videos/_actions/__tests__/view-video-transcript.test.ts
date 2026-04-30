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

import { viewVideoTranscriptAction } from "../view-video-transcript";
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

describe("viewVideoTranscriptAction", () => {
  it("returns transcript + writes view_transcript audit", async () => {
    const client = buildSupabaseClient([
      {
        // canonical lookup
        table: "summaries",
        response: {
          data: {
            id: VALID_SUMMARY_UUID,
            video_id: VALID_VIDEO_UUID,
            transcript: "the transcript",
            transcript_source: "auto_captions",
            enable_thinking: false,
            created_at: "2026-04-01T00:00:00Z",
          },
          error: null,
        },
      },
      {
        // video metadata
        table: "videos",
        response: {
          data: {
            title: "Vid Title",
            channel_name: "Channel",
            language: "en",
          },
          error: null,
        },
      },
    ]);
    requireAdminClientMock.mockReturnValue(client);
    writeAuditMock.mockResolvedValue({ ok: true, id: "audit-1" });

    const result = await viewVideoTranscriptAction(VALID_VIDEO_UUID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transcript).toBe("the transcript");
    expect(result.source).toBe("auto_captions");
    expect(result.videoTitle).toBe("Vid Title");
    expect(result.videoFetchFailed).toBe(false);
    expect(result.auditId).toBe("audit-1");

    const auditCall = writeAuditMock.mock.calls[0][1];
    expect(auditCall.action).toBe("view_transcript");
    expect(auditCall.resourceType).toBe("summary");
    expect(auditCall.resourceId).toBe(VALID_SUMMARY_UUID);
    expect(auditCall.metadata).toEqual({
      video_id: VALID_VIDEO_UUID,
      used_fallback_variant: false,
    });
  });

  it("returns video_not_found when no summary exists", async () => {
    const client = buildSupabaseClient([
      { table: "summaries", response: { data: null, error: null } },
      { table: "summaries", response: { data: null, error: null } },
    ]);
    requireAdminClientMock.mockReturnValue(client);
    const result = await viewVideoTranscriptAction(VALID_VIDEO_UUID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("video_not_found");
  });

  it("returns invalid_video_id for non-UUID input", async () => {
    const result = await viewVideoTranscriptAction("nope");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_video_id");
  });

  it("returns missing_video_id for empty input", async () => {
    const result = await viewVideoTranscriptAction("");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing_video_id");
  });

  it("propagates Next's redirect throw from the gate (no audit, no DB read)", async () => {
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/;0",
    });
    requireAdminPageMock.mockRejectedValueOnce(redirectError);
    const fromSpy = vi.fn();
    requireAdminClientMock.mockReturnValue({
      from: fromSpy,
    } as unknown as SupabaseClient);

    await expect(
      viewVideoTranscriptAction(VALID_VIDEO_UUID),
    ).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT/),
    });
    expect(fromSpy).not.toHaveBeenCalled();
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("returns internal_error and skips audit when canonical fetch errors", async () => {
    const client = buildSupabaseClient([
      {
        table: "summaries",
        response: { data: null, error: { message: "table missing" } },
      },
    ]);
    requireAdminClientMock.mockReturnValue(client);

    const result = await viewVideoTranscriptAction(VALID_VIDEO_UUID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("internal_error");
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("returns internal_error and skips audit when fallback fetch errors", async () => {
    const client = buildSupabaseClient([
      { table: "summaries", response: { data: null, error: null } },
      {
        table: "summaries",
        response: { data: null, error: { message: "fallback boom" } },
      },
    ]);
    requireAdminClientMock.mockReturnValue(client);

    const result = await viewVideoTranscriptAction(VALID_VIDEO_UUID);
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
            id: VALID_SUMMARY_UUID,
            video_id: VALID_VIDEO_UUID,
            transcript: "raw",
            transcript_source: "unknown_future_source",
            enable_thinking: false,
            created_at: "2026-04-29T10:00:00Z",
          },
          error: null,
        },
      },
    ]);
    requireAdminClientMock.mockReturnValue(client);

    const result = await viewVideoTranscriptAction(VALID_VIDEO_UUID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("internal_error");
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("sets usedFallbackVariant=true when canonical missing and fallback returned", async () => {
    const client = buildSupabaseClient([
      { table: "summaries", response: { data: null, error: null } },
      {
        table: "summaries",
        response: {
          data: {
            id: VALID_SUMMARY_UUID,
            video_id: VALID_VIDEO_UUID,
            transcript: "fallback transcript",
            transcript_source: "auto_captions",
            enable_thinking: true,
            created_at: "2026-04-02T00:00:00Z",
          },
          error: null,
        },
      },
      { table: "videos", response: { data: null, error: null } },
    ]);
    requireAdminClientMock.mockReturnValue(client);
    writeAuditMock.mockResolvedValue({ ok: true, id: "audit-fb" });

    const result = await viewVideoTranscriptAction(VALID_VIDEO_UUID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usedFallbackVariant).toBe(true);
    const auditCall = writeAuditMock.mock.calls[0][1];
    expect((auditCall.metadata as Record<string, unknown>).used_fallback_variant).toBe(true);
  });

  it("flags videoFetchFailed when video metadata fetch errors", async () => {
    const client = buildSupabaseClient([
      {
        table: "summaries",
        response: {
          data: {
            id: VALID_SUMMARY_UUID,
            video_id: VALID_VIDEO_UUID,
            transcript: "txt",
            transcript_source: "auto_captions",
            enable_thinking: false,
            created_at: "2026-04-01T00:00:00Z",
          },
          error: null,
        },
      },
      {
        table: "videos",
        response: { data: null, error: { message: "db down" } },
      },
    ]);
    requireAdminClientMock.mockReturnValue(client);
    writeAuditMock.mockResolvedValue({ ok: true, id: "audit-2" });
    const result = await viewVideoTranscriptAction(VALID_VIDEO_UUID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.videoFetchFailed).toBe(true);
    expect(result.transcript).toBe("txt");
  });

  it("fails open: returns transcript when audit write rejects", async () => {
    const client = buildSupabaseClient([
      {
        table: "summaries",
        response: {
          data: {
            id: VALID_SUMMARY_UUID,
            video_id: VALID_VIDEO_UUID,
            transcript: "the transcript",
            transcript_source: "auto_captions",
            enable_thinking: false,
            created_at: "2026-04-01T00:00:00Z",
          },
          error: null,
        },
      },
      { table: "videos", response: { data: null, error: null } },
    ]);
    requireAdminClientMock.mockReturnValue(client);
    writeAuditMock.mockResolvedValue({ ok: false, reason: "audit-down" });
    const result = await viewVideoTranscriptAction(VALID_VIDEO_UUID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.auditId).toBeNull();
    expect(result.auditFailureReason).toBe("audit-down");
  });
});
