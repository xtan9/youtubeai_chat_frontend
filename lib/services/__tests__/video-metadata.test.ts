import { afterEach, describe, it, expect, vi } from "vitest";
import { fetchVideoMetadata } from "../video-metadata";

describe("fetchVideoMetadata", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok result with parsed title and channel on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ title: "Hello World", author_name: "Channel X" }),
          { status: 200 }
        )
      )
    );
    const result = await fetchVideoMetadata(
      "https://www.youtube.com/watch?v=abc123"
    );
    expect(result).toEqual({
      ok: true,
      data: { title: "Hello World", channelName: "Channel X" },
    });
  });

  it("returns ok:false reason:non_ok with status on 4xx/5xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 404 }))
    );
    const result = await fetchVideoMetadata(
      "https://www.youtube.com/watch?v=abc123"
    );
    expect(result).toEqual({ ok: false, reason: "non_ok", status: 404 });
  });

  it("returns ok:false reason:error on network throw", async () => {
    const netErr = new Error("network down");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(netErr));
    const result = await fetchVideoMetadata(
      "https://www.youtube.com/watch?v=abc123"
    );
    expect(result).toEqual({ ok: false, reason: "error", error: netErr });
  });

  it("returns ok:false reason:aborted when abort signal fires", async () => {
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortErr));
    const result = await fetchVideoMetadata(
      "https://www.youtube.com/watch?v=abc123"
    );
    expect(result).toEqual({ ok: false, reason: "aborted" });
  });

  it("returns ok:true with empty strings when oembed payload lacks fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ title: "only title" }), { status: 200 })
      )
    );
    const result = await fetchVideoMetadata(
      "https://www.youtube.com/watch?v=abc123"
    );
    expect(result).toEqual({
      ok: true,
      data: { title: "only title", channelName: "" },
    });
  });
});
