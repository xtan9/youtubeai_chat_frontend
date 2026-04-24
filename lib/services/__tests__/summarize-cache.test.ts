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
    const c = computeVideoKey("https://music.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(a).toBe(b);
    expect(b).toBe(c);
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
    expect(await getCachedSummary("https://youtu.be/x")).toBeNull();
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
      await getCachedSummary("https://youtu.be/dQw4w9WgXcQ")
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
      await getCachedSummary("https://youtu.be/dQw4w9WgXcQ")
    ).toBeNull();
  });

  it("returns null on summary lookup error (fail-open)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.maybeSingle.mockResolvedValue({
      data: { id: "v1", title: "t", channel_name: "c", language: "en" },
      error: null,
    });
    mocks.summariesBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { getCachedSummary } = await loadFresh();
    expect(
      await getCachedSummary("https://youtu.be/dQw4w9WgXcQ")
    ).toBeNull();
  });

  it("logs generic schema mismatch for non-invariant drift", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.maybeSingle.mockResolvedValue({
      data: { id: "v1", title: "t", channel_name: "c", language: "en" },
      error: null,
    });
    mocks.summariesBuilder.maybeSingle.mockResolvedValue({
      data: {
        transcript: "t",
        summary: null, // schema expects string
        transcript_source: "auto_captions",
        model: "m",
        processing_time_seconds: 1,
        transcribe_time_seconds: 0.5,
        summarize_time_seconds: 0.5,
      },
      error: null,
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const { getCachedSummary } = await loadFresh();
    expect(
      await getCachedSummary("https://youtu.be/dQw4w9WgXcQ")
    ).toBeNull();
    expect(error.mock.calls.some((c) => String(c[0]).includes("schema mismatch"))).toBe(
      true
    );
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
        transcript_source: "whisper",
        model: "m1",
        processing_time_seconds: 12.5,
        transcribe_time_seconds: 7,
        summarize_time_seconds: 5.5,
      },
      error: null,
    });

    const { getCachedSummary } = await loadFresh();
    const result = await getCachedSummary("https://youtu.be/dQw4w9WgXcQ");
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
    });
  });

  it("derives summarizeTimeSeconds for legacy rows missing the column", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.maybeSingle.mockResolvedValue({
      data: { id: "v1", title: "t", channel_name: "c", language: "en" },
      error: null,
    });
    mocks.summariesBuilder.maybeSingle.mockResolvedValue({
      data: {
        transcript: "tr",
        summary: "su",
        transcript_source: "whisper",
        model: "m",
        processing_time_seconds: 10,
        transcribe_time_seconds: 4,
        summarize_time_seconds: null,
      },
      error: null,
    });

    const { getCachedSummary } = await loadFresh();
    const result = await getCachedSummary("https://youtu.be/dQw4w9WgXcQ");
    expect(result?.summarizeTimeSeconds).toBe(6);
    expect(result?.transcribeTimeSeconds).toBe(4);
  });

  it("memoizes the Supabase client across calls", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    const { getCachedSummary } = await loadFresh();
    await getCachedSummary("https://youtu.be/a");
    await getCachedSummary("https://youtu.be/b");
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });
});

describe("writeCachedSummary", () => {
  beforeEach(() => {
    mocks.createClient.mockClear();
    mocks.videosBuilder.single.mockReset();
    mocks.videosBuilder.upsert.mockClear();
    mocks.summariesBuilder.upsert.mockClear();
    mocks.historyBuilder.upsert.mockClear();
    vi.unstubAllEnvs();
  });

  const baseParams = {
    youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
    title: "t",
    channelName: "c",
    language: "en" as const,
    transcript: "tr",
    summary: "su",
    transcriptSource: "whisper" as const,
    model: "m",
    processingTimeSeconds: 1,
    transcribeTimeSeconds: 0.5,
    summarizeTimeSeconds: 0.5,
  };

  it("warns and returns without throwing when creds missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { writeCachedSummary } = await loadFresh();
    await writeCachedSummary({
      ...baseParams,
      youtubeUrl: "https://youtu.be/x",
    });
    expect(warn).toHaveBeenCalled();
  });

  it("upserts videos with url_hash onConflict", async () => {
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
    await writeCachedSummary(baseParams);

    const videosCall = mocks.videosBuilder.upsert.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(videosCall[1]).toEqual({ onConflict: "url_hash" });
  });

  it("upserts summaries with video_id onConflict", async () => {
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
    await writeCachedSummary(baseParams);

    const summariesCall = mocks.summariesBuilder.upsert.mock
      .calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(summariesCall[1]).toEqual({ onConflict: "video_id" });
    expect(summariesCall[0]).toMatchObject({
      transcribe_time_seconds: 0.5,
      summarize_time_seconds: 0.5,
    });
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
    await writeCachedSummary(baseParams);
    expect(mocks.historyBuilder.upsert).not.toHaveBeenCalled();
  });

  it("upserts history with composite user_id,video_id onConflict when userId present", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.single.mockResolvedValue({
      data: { id: "v1" },
      error: null,
    });
    mocks.summariesBuilder.upsert.mockReturnValueOnce(
      Promise.resolve({ error: null }) as unknown as typeof mocks.summariesBuilder
    );
    mocks.historyBuilder.upsert.mockReturnValueOnce(
      Promise.resolve({ error: null }) as unknown as typeof mocks.historyBuilder
    );

    const { writeCachedSummary } = await loadFresh();
    await writeCachedSummary({ ...baseParams, userId: "user-1" });

    const historyCall = mocks.historyBuilder.upsert.mock
      .calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(historyCall[1]).toEqual({ onConflict: "user_id,video_id" });
    expect(historyCall[0]).toEqual({ user_id: "user-1", video_id: "v1" });
  });

  it("throws when video upsert fails (so route's .catch logs with context)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.single.mockResolvedValue({
      data: null,
      error: { message: "unique violation" },
    });

    const { writeCachedSummary } = await loadFresh();
    await expect(writeCachedSummary(baseParams)).rejects.toThrow(
      /video upsert failed: unique violation/
    );
  });

  it("throws when summary upsert fails (surface partial-write, avoid orphan videos row)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.single.mockResolvedValue({
      data: { id: "v1" },
      error: null,
    });
    mocks.summariesBuilder.upsert.mockReturnValueOnce(
      Promise.resolve({
        error: { message: "summaries upsert blew up" },
      }) as unknown as typeof mocks.summariesBuilder
    );

    const { writeCachedSummary } = await loadFresh();
    await expect(writeCachedSummary(baseParams)).rejects.toThrow(
      /summary upsert failed: summaries upsert blew up/
    );
  });

  it("throws when history upsert fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.single.mockResolvedValue({
      data: { id: "v1" },
      error: null,
    });
    mocks.summariesBuilder.upsert.mockReturnValueOnce(
      Promise.resolve({ error: null }) as unknown as typeof mocks.summariesBuilder
    );
    mocks.historyBuilder.upsert.mockReturnValueOnce(
      Promise.resolve({
        error: { message: "history upsert blew up" },
      }) as unknown as typeof mocks.historyBuilder
    );

    const { writeCachedSummary } = await loadFresh();
    await expect(
      writeCachedSummary({ ...baseParams, userId: "user-1" })
    ).rejects.toThrow(/history upsert failed: history upsert blew up/);
  });

  it("rejects empty summary (invariant: never cache an empty row)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.single.mockResolvedValue({
      data: { id: "v1" },
      error: null,
    });
    const { writeCachedSummary } = await loadFresh();
    await expect(
      writeCachedSummary({ ...baseParams, summary: "" })
    ).rejects.toThrow(/summary write rejected by invariant check/);
    expect(mocks.summariesBuilder.upsert).not.toHaveBeenCalled();
  });
});
