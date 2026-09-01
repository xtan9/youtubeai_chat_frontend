import { describe, expect, it } from "vitest";

import {
  buildChannelHubVideoHref,
  readChannelHubVideoFilter,
} from "../links";

describe("Channel Hub owned Video links", () => {
  it("builds a filtered Hub link from an owned Video identifier", () => {
    expect(buildChannelHubVideoHref("video-123")).toBe(
      "/channel?videoId=video-123",
    );
    expect(buildChannelHubVideoHref("video/with spaces")).toBeNull();
  });

  it("accepts only bounded safe filter values from a request", () => {
    expect(
      readChannelHubVideoFilter(
        new URL("https://youtubeai.chat/channel?videoId=video-123").searchParams,
      ),
    ).toBe("video-123");
    expect(
      readChannelHubVideoFilter(
        new URL("https://youtubeai.chat/channel?videoId=video/123").searchParams,
      ),
    ).toBeNull();
    expect(readChannelHubVideoFilter(null)).toBeNull();
  });
});
