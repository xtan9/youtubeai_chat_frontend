import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getServiceRoleClient: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));

import { nominateCatalogVideoForAdmission } from "../catalog-admission";

const YOUTUBE_URL = "https://youtu.be/dQw4w9WgXcQ";

function youtubeResponse(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      items: [
        {
          id: "dQw4w9WgXcQ",
          snippet: {
            title: "Verified title",
            channelId: "channel-1",
            channelTitle: "Verified channel",
            publishedAt: "2025-01-02T03:04:05Z",
            defaultAudioLanguage: "en-US",
            liveBroadcastContent: "none",
            thumbnails: {
              medium: { url: "https://i.ytimg.com/vi/id/mqdefault.jpg" },
            },
          },
          status: { privacyStatus: "public", embeddable: true },
          contentDetails: {
            duration: "PT2M3S",
            contentRating: {},
          },
          ...overrides,
        },
      ],
    }),
    { status: 200 },
  );
}

describe("nominateCatalogVideoForAdmission", () => {
  beforeEach(() => {
    vi.stubEnv("YOUTUBE_DATA_API_KEY", "provider-key");
    mocks.rpc.mockReset();
    mocks.getServiceRoleClient.mockReset();
    mocks.rpc.mockResolvedValue({ data: { outcome: "enqueued" }, error: null });
    mocks.getServiceRoleClient.mockReturnValue({
      rpc: mocks.rpc,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("requests one learner-unlinked nomination for independently verified eligible metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(youtubeResponse()));

    await expect(
      nominateCatalogVideoForAdmission({
        youtubeUrl: YOUTUBE_URL,
        requestId: "trace-1",
      }),
    ).resolves.toEqual({ outcome: "enqueued" });

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "request_catalog_nomination",
      expect.objectContaining({
        p_youtube_video_id: "dQw4w9WgXcQ",
        p_title: "Verified title",
        p_channel_id: "channel-1",
        p_channel_name: "Verified channel",
        p_thumbnail_url: "https://i.ytimg.com/vi/id/mqdefault.jpg",
        p_duration_seconds: 123,
        p_privacy_status: "public",
        p_embeddable: true,
        p_live_status: "none",
        p_age_restricted: false,
        p_trace_id: "trace-1",
      }),
    );

    const payload = mocks.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(payload)).not.toEqual(
      expect.arrayContaining([
        "user_id",
        "session_id",
        "output_language",
        "transcript",
        "summary",
        "request_content",
      ]),
    );
  });

  it("does not enqueue when cancellation occurs during provider verification", async () => {
    const controller = new AbortController();
    let resolveProvider!: (response: Response) => void;
    const providerResponse = new Promise<Response>((resolve) => {
      resolveProvider = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(providerResponse);
    vi.stubGlobal("fetch", fetchMock);
    let cancelled = false;

    const nomination = nominateCatalogVideoForAdmission({
      youtubeUrl: YOUTUBE_URL,
      requestId: "trace-cancelled",
      signal: controller.signal,
      isCancelled: () => cancelled,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    cancelled = true;
    controller.abort();
    resolveProvider(youtubeResponse());

    await expect(nomination).resolves.toEqual({
      outcome: "skipped",
      reason: "cancelled",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["private", "unlisted"])(
    "does not nominate a %s Video",
    async (privacyStatus) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          youtubeResponse({
            status: { privacyStatus, embeddable: true },
          }),
        ),
      );

      await expect(
        nominateCatalogVideoForAdmission({
          youtubeUrl: YOUTUBE_URL,
          requestId: "trace-private",
        }),
      ).resolves.toEqual({
        outcome: "skipped",
        reason: "ineligible",
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["not embeddable", { status: { privacyStatus: "public", embeddable: false } }],
    [
      "live",
      {
        snippet: {
          title: "Live",
          channelId: "channel-1",
          channelTitle: "Channel",
          publishedAt: "2025-01-02T03:04:05Z",
          liveBroadcastContent: "live",
          thumbnails: {},
        },
      },
    ],
    [
      "upcoming",
      {
        snippet: {
          title: "Upcoming",
          channelId: "channel-1",
          channelTitle: "Channel",
          publishedAt: "2025-01-02T03:04:05Z",
          liveBroadcastContent: "upcoming",
          thumbnails: {},
        },
      },
    ],
    [
      "age restricted",
      {
        contentDetails: {
          duration: "PT1M",
          contentRating: { ytRating: "ytAgeRestricted" },
        },
      },
    ],
  ])("does not nominate when the source is %s", async (_label, overrides) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(youtubeResponse(overrides)),
    );

    await expect(
      nominateCatalogVideoForAdmission({
        youtubeUrl: YOUTUBE_URL,
        requestId: "trace-ineligible",
      }),
    ).resolves.toEqual({ outcome: "skipped", reason: "ineligible" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["missing API key", "", youtubeResponse()],
    ["provider failure", "provider-key", new Response("nope", { status: 503 })],
    ["malformed metadata", "provider-key", new Response("{}", { status: 200 })],
    [
      "authoritative provider absence",
      "provider-key",
      new Response('{"items":[]}', { status: 200 }),
    ],
  ])(
    "does not nominate when metadata is unverifiable: %s",
    async (_label, apiKey, response) => {
      vi.stubEnv("YOUTUBE_DATA_API_KEY", apiKey);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      await expect(
        nominateCatalogVideoForAdmission({
          youtubeUrl: YOUTUBE_URL,
          requestId: "trace-unverifiable",
        }),
      ).resolves.toEqual({
        outcome: "skipped",
        reason: "provider_unavailable",
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("classifies a durable nomination write failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(youtubeResponse()));
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "queue unavailable" },
    });

    await expect(
      nominateCatalogVideoForAdmission({
        youtubeUrl: YOUTUBE_URL,
        requestId: "trace-failure",
      }),
    ).rejects.toMatchObject({
      name: "CatalogNominationError",
      errorId: "CATALOG_NOMINATION_ENQUEUE_FAILED",
    });
  });
});
