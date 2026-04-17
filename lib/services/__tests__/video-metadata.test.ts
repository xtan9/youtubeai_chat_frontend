import { afterEach, describe, it, expect, vi } from "vitest";
import { fetchVideoMetadata } from "../video-metadata";

describe("fetchVideoMetadata", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed title and channel on 200", async () => {
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
    expect(result).toEqual({ title: "Hello World", channelName: "Channel X" });
  });

  it("returns empty strings on non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 404 }))
    );
    const result = await fetchVideoMetadata(
      "https://www.youtube.com/watch?v=abc123"
    );
    expect(result).toEqual({ title: "", channelName: "" });
  });

  it("returns empty strings on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );
    const result = await fetchVideoMetadata(
      "https://www.youtube.com/watch?v=abc123"
    );
    expect(result).toEqual({ title: "", channelName: "" });
  });

  it("tolerates missing fields in oembed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ title: "only title" }), { status: 200 })
      )
    );
    const result = await fetchVideoMetadata(
      "https://www.youtube.com/watch?v=abc123"
    );
    expect(result).toEqual({ title: "only title", channelName: "" });
  });
});
