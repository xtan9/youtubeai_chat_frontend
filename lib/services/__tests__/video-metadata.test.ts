import { afterEach, describe, it, expect, vi } from "vitest";
import { fetchVideoMetadata } from "../video-metadata";

describe("fetchVideoMetadata", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok result on 200", async () => {
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

  it("fills empty strings when payload fields missing", async () => {
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

  it("returns reason:non_ok with status on 4xx/5xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 404 }))
    );
    const result = await fetchVideoMetadata(
      "https://www.youtube.com/watch?v=abc123"
    );
    expect(result).toEqual({ ok: false, reason: "non_ok", status: 404 });
  });

  it("returns reason:schema when response violates shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("null", { status: 200 }))
    );
    const result = await fetchVideoMetadata(
      "https://www.youtube.com/watch?v=abc123"
    );
    expect(result).toEqual({ ok: false, reason: "schema" });
  });

  it("returns reason:error on network throw", async () => {
    const netErr = new Error("network down");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(netErr));
    const result = await fetchVideoMetadata(
      "https://www.youtube.com/watch?v=abc123"
    );
    expect(result).toEqual({ ok: false, reason: "error", error: netErr });
  });

  it("returns reason:timeout when internal 5s timer fires (NOT aborted)", async () => {
    const timeoutErr = new Error("timed out");
    timeoutErr.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeoutErr));
    const result = await fetchVideoMetadata(
      "https://www.youtube.com/watch?v=abc123"
    );
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("returns reason:aborted when caller signal fires", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        Object.assign(new Error("aborted"), { name: "AbortError" })
      )
    );
    const result = await fetchVideoMetadata(
      "https://www.youtube.com/watch?v=abc123",
      controller.signal
    );
    expect(result).toEqual({ ok: false, reason: "aborted" });
  });

  it("classifies AbortError as error (not aborted) when caller signal never fired", async () => {
    // An AbortError from our internal timeout shouldn't look like caller-aborted.
    // Without a caller signal, the function sees `signal?.aborted === false`
    // and falls through to the generic error branch.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        Object.assign(new Error("boom"), { name: "AbortError" })
      )
    );
    const result = await fetchVideoMetadata(
      "https://www.youtube.com/watch?v=abc123"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("error");
    }
  });
});
