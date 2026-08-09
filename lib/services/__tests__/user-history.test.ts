import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRecentHistory, getHistoryPage } from "../user-history";

type RpcPayload = {
  outcome?: string;
  rows?: unknown[];
  total?: number | null;
};

function makeSupabase(payload: RpcPayload, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data: payload, error });
  return { rpc };
}

function asClient(value: unknown): SupabaseClient {
  return value as SupabaseClient;
}

const ROW = {
  videoId: "v-uuid-1",
  youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  youtubeVideoId: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up",
  channelName: "Rick Astley",
  viewedAt: "2026-04-28T12:00:00Z",
};

describe("getRecentHistory", () => {
  it("returns mapped rows in shape consumers expect", async () => {
    const supabase = makeSupabase({ outcome: "resolved", rows: [ROW], total: 1 });
    const result = await getRecentHistory(asClient(supabase), "u-1");
    expect(result).toEqual({
      ok: true,
      rows: [
        {
          videoId: "v-uuid-1",
          youtubeUrl: ROW.youtubeUrl,
          youtubeVideoId: "dQw4w9WgXcQ",
          title: "Never Gonna Give You Up",
          channelName: "Rick Astley",
          viewedAt: ROW.viewedAt,
        },
      ],
    });
  });

  it("keeps the supplied user scoped to the RPC and defaults limit to 10", async () => {
    const supabase = makeSupabase({ outcome: "resolved", rows: [], total: 0 });
    await getRecentHistory(asClient(supabase), "u-42");
    expect(supabase.rpc).toHaveBeenCalledWith("list_user_video_history", {
      p_user_id: "u-42",
      p_page: 1,
      p_page_size: 10,
    });
  });

  it("honors a custom limit", async () => {
    const supabase = makeSupabase({ outcome: "resolved", rows: [], total: 0 });
    await getRecentHistory(asClient(supabase), "u-1", 5);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "list_user_video_history",
      expect.objectContaining({ p_page_size: 5 }),
    );
  });

  it("normalizes a raw ID and returns null for malformed identity data", async () => {
    const supabase = makeSupabase({
      outcome: "resolved",
      rows: [
        ROW,
        { ...ROW, videoId: "v-uuid-2", youtubeVideoId: "not-valid" },
      ],
      total: 2,
    });
    const result = await getRecentHistory(asClient(supabase), "u-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].youtubeVideoId).toBe("dQw4w9WgXcQ");
    expect(result.rows[1].youtubeVideoId).toBeNull();
  });

  it("returns ok:false on RPC error and logs", async () => {
    const supabase = makeSupabase({}, { message: "boom", code: "42501" });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getRecentHistory(asClient(supabase), "u-1")).resolves.toEqual({
      ok: false,
    });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("getHistoryPage", () => {
  it("passes the requested page and page size to the owner-scoped RPC", async () => {
    const supabase = makeSupabase({ outcome: "resolved", rows: [ROW], total: 53 });
    const result = await getHistoryPage(asClient(supabase), "u-1", 3, 10);
    expect(supabase.rpc).toHaveBeenCalledWith("list_user_video_history", {
      p_user_id: "u-1",
      p_page: 3,
      p_page_size: 10,
    });
    expect(result).toMatchObject({ ok: true, total: 53, totalPages: 6 });
  });

  it("clamps page<1 and computes totalPages=0 for empty history", async () => {
    const supabase = makeSupabase({ outcome: "resolved", rows: [], total: 0 });
    const result = await getHistoryPage(asClient(supabase), "u-1", 0, 25);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "list_user_video_history",
      expect.objectContaining({ p_page: 1 }),
    );
    expect(result).toMatchObject({ ok: true, total: 0, totalPages: 0, rows: [] });
  });

  it("returns ok:false for malformed RPC payloads", async () => {
    const supabase = makeSupabase({ outcome: "resolved", rows: [], total: null });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getHistoryPage(asClient(supabase), "u-1", 1, 25)).resolves.toEqual({
      ok: false,
    });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("returns ok:false when the RPC promise rejects", async () => {
    const supabase = { rpc: vi.fn().mockRejectedValue(new Error("network down")) };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getHistoryPage(asClient(supabase), "u-1", 1, 25)).resolves.toEqual({
      ok: false,
    });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
