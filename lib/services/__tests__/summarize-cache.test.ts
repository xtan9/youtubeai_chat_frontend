import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const builder = () => {
    const b = {
      select: vi.fn(() => b),
      eq: vi.fn(() => b),
      maybeSingle: vi.fn(),
      single: vi.fn(),
      upsert: vi.fn(() => b),
    };
    return b;
  };
  const videosBuilder = builder();
  const summariesBuilder = builder();
  const historyBuilder = builder();
  const from = vi.fn((table: string) => {
    if (table === "videos") return videosBuilder;
    if (table === "summaries") return summariesBuilder;
    return historyBuilder;
  });
  const createClient = vi.fn(() => ({ from }));
  return { createClient, from, videosBuilder, summariesBuilder, historyBuilder };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

async function loadFresh() {
  vi.resetModules();
  return await import("../summarize-cache");
}

describe("computeVideoKey", () => {
  it("returns the 11-char video ID for canonical URLs", async () => {
    const { computeVideoKey } = await loadFresh();
    expect(computeVideoKey("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ"
    );
    expect(
      computeVideoKey("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    ).toBe("dQw4w9WgXcQ");
    expect(
      computeVideoKey("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s")
    ).toBe("dQw4w9WgXcQ");
  });

  it("collapses URL variants to a single cache key", async () => {
    const { computeVideoKey } = await loadFresh();
    const a = computeVideoKey("https://youtu.be/dQw4w9WgXcQ");
    const b = computeVideoKey("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(a).toBe(b);
  });

  it("falls back to md5 when no video ID can be extracted", async () => {
    const { computeVideoKey } = await loadFresh();
    const hash = computeVideoKey("not-a-youtube-url");
    expect(hash).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe("getCachedSummary", () => {
  beforeEach(() => {
    mocks.createClient.mockClear();
    mocks.videosBuilder.maybeSingle.mockReset();
    mocks.videosBuilder.select.mockClear();
    mocks.videosBuilder.eq.mockClear();
    mocks.summariesBuilder.maybeSingle.mockReset();
    mocks.summariesBuilder.select.mockClear();
    mocks.summariesBuilder.eq.mockClear();
    vi.unstubAllEnvs();
  });

  afterEach(() => vi.restoreAllMocks());

  it("returns null when creds missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { getCachedSummary } = await loadFresh();
    expect(await getCachedSummary("https://youtu.be/x", false)).toBeNull();
  });

  it("returns null on video lookup error (fail-open)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { getCachedSummary } = await loadFresh();
    expect(
      await getCachedSummary("https://youtu.be/dQw4w9WgXcQ", false)
    ).toBeNull();
  });

  it("returns null when video row has bad schema (fail-open)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.maybeSingle.mockResolvedValue({
      data: { id: "v1", title: 123, channel_name: null, language: "xx" },
      error: null,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { getCachedSummary } = await loadFresh();
    expect(
      await getCachedSummary("https://youtu.be/dQw4w9WgXcQ", false)
    ).toBeNull();
  });

  it("returns null when summary thinking violates invariant (fail-open)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.maybeSingle.mockResolvedValue({
      data: { id: "v1", title: "t", channel_name: "c", language: "en" },
      error: null,
    });
    mocks.summariesBuilder.maybeSingle.mockResolvedValue({
      data: {
        transcript: "t",
        summary: "s",
        thinking: "should-be-null",
        transcript_source: "auto_captions",
        enable_thinking: false,
        model: "m",
        processing_time_seconds: 1,
        transcribe_time_seconds: 0.5,
        summarize_time_seconds: 0.5,
      },
      error: null,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { getCachedSummary } = await loadFresh();
    expect(
      await getCachedSummary("https://youtu.be/dQw4w9WgXcQ", false)
    ).toBeNull();
  });

  it("returns fully typed CachedSummary on happy path", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.maybeSingle.mockResolvedValue({
      data: {
        id: "v1",
        title: "My Vid",
        channel_name: "Chan",
        language: "zh",
      },
      error: null,
    });
    mocks.summariesBuilder.maybeSingle.mockResolvedValue({
      data: {
        transcript: "tr",
        summary: "su",
        thinking: null,
        transcript_source: "whisper",
        enable_thinking: false,
        model: "m1",
        processing_time_seconds: 12.5,
        transcribe_time_seconds: 7,
        summarize_time_seconds: 5.5,
      },
      error: null,
    });

    const { getCachedSummary } = await loadFresh();
    const result = await getCachedSummary(
      "https://youtu.be/dQw4w9WgXcQ",
      false
    );
    expect(result).toEqual({
      videoId: "v1",
      title: "My Vid",
      channelName: "Chan",
      language: "zh",
      transcript: "tr",
      summary: "su",
      transcriptSource: "whisper",
      model: "m1",
      processingTimeSeconds: 12.5,
      transcribeTimeSeconds: 7,
      summarizeTimeSeconds: 5.5,
      enableThinking: false,
      thinking: null,
    });
  });

  it("filters by enable_thinking when reading", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.maybeSingle.mockResolvedValue({
      data: { id: "v1", title: "t", channel_name: "c", language: "en" },
      error: null,
    });
    mocks.summariesBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    const { getCachedSummary } = await loadFresh();
    await getCachedSummary("https://youtu.be/dQw4w9WgXcQ", true);
    const eqCalls = mocks.summariesBuilder.eq.mock.calls;
    expect(eqCalls).toContainEqual(["enable_thinking", true]);
    expect(eqCalls).toContainEqual(["video_id", "v1"]);
  });

  it("memoizes the Supabase client across calls", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    const { getCachedSummary } = await loadFresh();
    await getCachedSummary("https://youtu.be/a", false);
    await getCachedSummary("https://youtu.be/b", false);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });
});

describe("writeCachedSummary", () => {
  beforeEach(() => {
    mocks.createClient.mockClear();
    mocks.videosBuilder.single.mockReset();
    mocks.summariesBuilder.upsert.mockClear();
    mocks.historyBuilder.upsert.mockClear();
    vi.unstubAllEnvs();
  });

  it("warns and returns without throwing when creds missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { writeCachedSummary } = await loadFresh();
    await writeCachedSummary({
      youtubeUrl: "https://youtu.be/x",
      title: "",
      channelName: "",
      language: "en",
      transcript: "t",
      summary: "s",
      transcriptSource: "whisper",
      model: "m",
      processingTimeSeconds: 1,
      transcribeTimeSeconds: 0,
      summarizeTimeSeconds: 1,
      enableThinking: false,
      thinking: null,
    });
    expect(warn).toHaveBeenCalled();
  });

  it("skips history upsert when userId not provided", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.single.mockResolvedValue({
      data: { id: "v1" },
      error: null,
    });
    mocks.summariesBuilder.upsert.mockReturnValueOnce(
      Promise.resolve({ error: null }) as unknown as typeof mocks.summariesBuilder
    );

    const { writeCachedSummary } = await loadFresh();
    await writeCachedSummary({
      youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
      title: "t",
      channelName: "c",
      language: "en",
      transcript: "tr",
      summary: "su",
      transcriptSource: "whisper",
      model: "m",
      processingTimeSeconds: 1,
      transcribeTimeSeconds: 0.5,
      summarizeTimeSeconds: 0.5,
      enableThinking: false,
      thinking: null,
    });
    expect(mocks.historyBuilder.upsert).not.toHaveBeenCalled();
  });
});
