// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChannelVideoLink } from "../channel-video-link";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChannelVideoLink", () => {
  it("renders a filtered Hub link only after the server confirms ownership", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            outcome: "owned",
            videoId: "video-123",
          }),
          { status: 200 },
        ),
      ),
    );

    render(
      <ChannelVideoLink
        sourceUrl="https://youtu.be/dQw4w9WgXcQ"
        enabled
      />,
    );

    expect(screen.queryByRole("link", { name: /channel hub/i })).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /open in channel hub/i }).getAttribute(
          "href",
        ),
      ).toBe("/channel?videoId=video-123"),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/channel/owned-video?url=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ",
      { cache: "no-store" },
    );
  });

  it("does not look up ownership when the release gate is closed", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ChannelVideoLink
        sourceUrl="https://youtu.be/dQw4w9WgXcQ"
        enabled={false}
      />,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /channel hub/i })).toBeNull();
  });
});
