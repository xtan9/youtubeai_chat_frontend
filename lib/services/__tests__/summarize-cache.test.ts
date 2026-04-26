import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const builder = () => {
    const b = {
      select: vi.fn(() => b),
      eq: vi.fn(() => b),
      is: vi.fn(() => b),
      maybeSingle: vi.fn(),
      single: vi.fn(),
      upsert: vi.fn(() => b),
    };
    return b;
  };
  const videosBuilder = builder();
  const summariesBuilder = builder();
  const historyBuilder = builder();
  const transcriptsBuilder = builder();
  const from = vi.fn((table: string) => {
    if (table === "videos") return videosBuilder;
    if (table === "summaries") return summariesBuilder;
    if (table === "video_transcripts") return transcriptsBuilder;
    return historyBuilder;
  });
  const createClient = vi.fn(() => ({ from }));
  return {
    createClient,
    from,
    videosBuilder,
    summariesBuilder,
    historyBuilder,
    transcriptsBuilder,
  };
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
    mocks.videosBuilder.is.mockClear();
    mocks.summariesBuilder.maybeSingle.mockReset();
    mocks.summariesBuilder.select.mockClear();
    mocks.summariesBuilder.eq.mockClear();
    mocks.summariesBuilder.is.mockClear();
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

  it("logs schema mismatch on row shape drift", async () => {
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
        output_language: null,
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
        output_language: null,
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
      outputLanguage: null,
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
        output_language: null,
      },
      error: null,
    });

    const { getCachedSummary } = await loadFresh();
    const result = await getCachedSummary("https://youtu.be/dQw4w9WgXcQ");
    expect(result?.summarizeTimeSeconds).toBe(6);
    expect(result?.transcribeTimeSeconds).toBe(4);
  });

  it("filters on output_language IS NULL by default", async () => {
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
    await getCachedSummary("https://youtu.be/dQw4w9WgXcQ");

    // `.eq("output_language", null)` would emit `col = NULL` (always false
    // under SQL three-valued logic). The service must use `.is(col, null)`.
    expect(mocks.summariesBuilder.is).toHaveBeenCalledWith(
      "output_language",
      null
    );
    const eqCalls = mocks.summariesBuilder.eq.mock.calls as ReadonlyArray<
      ReadonlyArray<unknown>
    >;
    expect(
      eqCalls.some((c) => c[0] === "output_language")
    ).toBe(false);
  });

  it("filters with equality when outputLanguage is provided", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.maybeSingle.mockResolvedValue({
      data: { id: "v1", title: "t", channel_name: "c", language: "en" },
      error: null,
    });
    mocks.summariesBuilder.maybeSingle.mockResolvedValue({
      data: {
        transcript: "tr",
        summary: "Hola!",
        transcript_source: "manual_captions",
        model: "m",
        processing_time_seconds: 2,
        transcribe_time_seconds: 1,
        summarize_time_seconds: 1,
        output_language: "es",
      },
      error: null,
    });

    const { getCachedSummary } = await loadFresh();
    const result = await getCachedSummary(
      "https://youtu.be/dQw4w9WgXcQ",
      "es"
    );

    expect(mocks.summariesBuilder.eq).toHaveBeenCalledWith(
      "output_language",
      "es"
    );
    expect(mocks.summariesBuilder.is).not.toHaveBeenCalled();
    expect(result?.summary).toBe("Hola!");
    expect(result?.outputLanguage).toBe("es");
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

  it("upserts summaries with composite (video_id,output_language) onConflict and NULL native column", async () => {
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
    expect(summariesCall[1]).toEqual({ onConflict: "video_id,output_language" });
    expect(summariesCall[0]).toMatchObject({
      transcribe_time_seconds: 0.5,
      summarize_time_seconds: 0.5,
      output_language: null,
    });
  });

  it("writes explicit output_language when caller supplies one", async () => {
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
    await writeCachedSummary({ ...baseParams, outputLanguage: "es" });

    const summariesCall = mocks.summariesBuilder.upsert.mock
      .calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(summariesCall[0]).toMatchObject({ output_language: "es" });
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
    ).rejects.toThrow(/summary write failed schema validation/);
    expect(mocks.summariesBuilder.upsert).not.toHaveBeenCalled();
  });
});

describe("getCachedTranscript", () => {
  beforeEach(() => {
    mocks.createClient.mockClear();
    mocks.videosBuilder.maybeSingle.mockReset();
    mocks.videosBuilder.select.mockClear();
    mocks.videosBuilder.eq.mockClear();
    mocks.transcriptsBuilder.maybeSingle.mockReset();
    mocks.transcriptsBuilder.select.mockClear();
    mocks.transcriptsBuilder.eq.mockClear();
    vi.unstubAllEnvs();
  });

  afterEach(() => vi.restoreAllMocks());

  it("returns null when creds missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { getCachedTranscript } = await loadFresh();
    expect(await getCachedTranscript("https://youtu.be/x")).toBeNull();
  });

  it("returns null when video row missing (cache miss is the safe default)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    const { getCachedTranscript } = await loadFresh();
    expect(
      await getCachedTranscript("https://youtu.be/dQw4w9WgXcQ")
    ).toBeNull();
    // Don't query transcripts when there's no video row to FK against.
    expect(mocks.transcriptsBuilder.select).not.toHaveBeenCalled();
  });

  it("returns null on video lookup error (fail-open)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { getCachedTranscript } = await loadFresh();
    expect(
      await getCachedTranscript("https://youtu.be/dQw4w9WgXcQ")
    ).toBeNull();
  });

  it("returns null on transcript lookup error (fail-open)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.maybeSingle.mockResolvedValue({
      data: { id: "v1", title: "t", channel_name: "c", language: "en" },
      error: null,
    });
    mocks.transcriptsBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { getCachedTranscript } = await loadFresh();
    expect(
      await getCachedTranscript("https://youtu.be/dQw4w9WgXcQ")
    ).toBeNull();
  });

  it("returns null when transcript row schema is invalid (fail-open)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.maybeSingle.mockResolvedValue({
      data: { id: "v1", title: "t", channel_name: "c", language: "en" },
      error: null,
    });
    mocks.transcriptsBuilder.maybeSingle.mockResolvedValue({
      // language "xx" violates the en|zh schema
      data: {
        segments: [{ text: "tr", start: 0, duration: 1 }],
        transcript_source: "whisper",
        language: "xx",
      },
      error: null,
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const { getCachedTranscript } = await loadFresh();
    expect(
      await getCachedTranscript("https://youtu.be/dQw4w9WgXcQ")
    ).toBeNull();
    expect(
      error.mock.calls.some((c) => String(c[0]).includes("schema mismatch"))
    ).toBe(true);
  });

  it("returns the parsed transcript on happy path", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.maybeSingle.mockResolvedValue({
      data: { id: "v1", title: "t", channel_name: "c", language: "en" },
      error: null,
    });
    mocks.transcriptsBuilder.maybeSingle.mockResolvedValue({
      data: {
        segments: [
          { text: "the cached", start: 0, duration: 1 },
          { text: "transcript", start: 1, duration: 1 },
        ],
        transcript_source: "whisper",
        language: "en",
      },
      error: null,
    });

    const { getCachedTranscript } = await loadFresh();
    const result = await getCachedTranscript(
      "https://youtu.be/dQw4w9WgXcQ"
    );
    expect(result).toEqual({
      videoId: "v1",
      title: "t",
      channelName: "c",
      segments: [
        { text: "the cached", start: 0, duration: 1 },
        { text: "transcript", start: 1, duration: 1 },
      ],
      transcriptSource: "whisper",
      language: "en",
    });
    expect(mocks.transcriptsBuilder.eq).toHaveBeenCalledWith(
      "video_id",
      "v1"
    );
  });

  // Regression guard: without this eviction, every video cached before
  // per-line timing was persisted renders as one un-clickable 00:00
  // paragraph forever — the cache shortcut returns the placeholder
  // verbatim and the user never gets clickable timestamps.
  it("evicts legacy backfill row (single 00:00 segment) and returns null", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.maybeSingle.mockResolvedValue({
      data: { id: "v1", title: "t", channel_name: "c", language: "en" },
      error: null,
    });
    mocks.transcriptsBuilder.maybeSingle.mockResolvedValue({
      data: {
        segments: [{ text: "the whole transcript at once", start: 0, duration: 0 }],
        transcript_source: "whisper",
        language: "en",
      },
      error: null,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { getCachedTranscript } = await loadFresh();
    expect(
      await getCachedTranscript("https://youtu.be/dQw4w9WgXcQ")
    ).toBeNull();
    expect(
      warn.mock.calls.some((c) =>
        String(c[1] && (c[1] as { errorId?: string }).errorId).includes(
          "TRANSCRIPT_LEGACY_BACKFILL_EVICT"
        )
      )
    ).toBe(true);
  });

  it("does NOT evict a single real segment with positive duration", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.maybeSingle.mockResolvedValue({
      data: { id: "v1", title: "t", channel_name: "c", language: "en" },
      error: null,
    });
    mocks.transcriptsBuilder.maybeSingle.mockResolvedValue({
      data: {
        // One segment, but duration > 0 → real (very-short-clip) data.
        segments: [{ text: "hi", start: 0, duration: 2 }],
        transcript_source: "whisper",
        language: "en",
      },
      error: null,
    });

    const { getCachedTranscript } = await loadFresh();
    const result = await getCachedTranscript(
      "https://youtu.be/dQw4w9WgXcQ"
    );
    expect(result?.segments).toEqual([
      { text: "hi", start: 0, duration: 2 },
    ]);
  });
});

describe("writeCachedTranscript", () => {
  beforeEach(() => {
    mocks.createClient.mockClear();
    mocks.videosBuilder.single.mockReset();
    mocks.videosBuilder.upsert.mockClear();
    mocks.transcriptsBuilder.upsert.mockClear();
    vi.unstubAllEnvs();
  });

  afterEach(() => vi.restoreAllMocks());

  const baseTranscript = {
    youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
    segments: [{ text: "the transcript", start: 0, duration: 1 }],
    transcriptSource: "whisper" as const,
    language: "en" as const,
  };

  it("warns and returns without throwing when creds missing (fail-open)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { writeCachedTranscript } = await loadFresh();
    await writeCachedTranscript(baseTranscript);
    expect(warn).toHaveBeenCalled();
    expect(mocks.videosBuilder.upsert).not.toHaveBeenCalled();
    expect(mocks.transcriptsBuilder.upsert).not.toHaveBeenCalled();
  });

  // Companion to the read-side eviction. Without this guard, a regressed
  // VPS that returns only `transcript` (legacy fallback path in
  // caption-extractor / vps-client wraps it in a single 0-duration segment)
  // would re-create rows the reader evicts on every request — looping
  // VPS captions/whisper compute.
  it("refuses to persist no-timing-shape segments and skips both upserts", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { writeCachedTranscript } = await loadFresh();
    await writeCachedTranscript({
      ...baseTranscript,
      segments: [{ text: "the whole thing", start: 0, duration: 0 }],
    });

    expect(
      warn.mock.calls.some((c) =>
        String(c[1] && (c[1] as { errorId?: string }).errorId).includes(
          "TRANSCRIPT_LEGACY_SHAPE_NOT_PERSISTED"
        )
      )
    ).toBe(true);
    expect(mocks.videosBuilder.upsert).not.toHaveBeenCalled();
    expect(mocks.transcriptsBuilder.upsert).not.toHaveBeenCalled();
  });

  it("upserts videos row first with url_hash onConflict, then transcripts row with video_id onConflict", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.single.mockResolvedValue({
      data: { id: "v1" },
      error: null,
    });
    mocks.transcriptsBuilder.upsert.mockReturnValueOnce(
      Promise.resolve({ error: null }) as unknown as typeof mocks.transcriptsBuilder
    );

    const { writeCachedTranscript } = await loadFresh();
    await writeCachedTranscript(baseTranscript);

    const videosCall = mocks.videosBuilder.upsert.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(videosCall[1]).toEqual({ onConflict: "url_hash" });

    const transcriptCall = mocks.transcriptsBuilder.upsert.mock
      .calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(transcriptCall[1]).toEqual({ onConflict: "video_id" });
    expect(transcriptCall[0]).toMatchObject({
      video_id: "v1",
      segments: [{ text: "the transcript", start: 0, duration: 1 }],
      transcript_source: "whisper",
      language: "en",
    });
  });

  it("writes title/channel into videos row when caller provides them (captions path)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.single.mockResolvedValue({
      data: { id: "v1" },
      error: null,
    });
    mocks.transcriptsBuilder.upsert.mockReturnValueOnce(
      Promise.resolve({ error: null }) as unknown as typeof mocks.transcriptsBuilder
    );

    const { writeCachedTranscript } = await loadFresh();
    await writeCachedTranscript({
      ...baseTranscript,
      title: "Big Buck Bunny",
      channelName: "Blender",
    });

    const videosCall = mocks.videosBuilder.upsert.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(videosCall[0]).toMatchObject({
      title: "Big Buck Bunny",
      channel_name: "Blender",
      language: "en",
    });
  });

  it("omits title/channel from the videos upsert when caller omits them (sparse upsert preserves existing values)", async () => {
    // Critical invariant: a fire-and-forget transcript-cache write that
    // resolves AFTER writeCachedSummary populated title/channel must NOT
    // clobber them back to NULL. Sparse upsert: omit the column from the
    // payload entirely, so Supabase's `DO UPDATE SET col = EXCLUDED.col`
    // never touches it.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.single.mockResolvedValue({
      data: { id: "v1" },
      error: null,
    });
    mocks.transcriptsBuilder.upsert.mockReturnValueOnce(
      Promise.resolve({ error: null }) as unknown as typeof mocks.transcriptsBuilder
    );

    const { writeCachedTranscript } = await loadFresh();
    await writeCachedTranscript(baseTranscript);

    const videosCall = mocks.videosBuilder.upsert.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    // url_hash + language always present; title + channel_name absent.
    expect(videosCall[0]).toEqual(
      expect.objectContaining({
        youtube_url: baseTranscript.youtubeUrl,
        language: "en",
      })
    );
    expect(videosCall[0]).not.toHaveProperty("title");
    expect(videosCall[0]).not.toHaveProperty("channel_name");
  });

  it("omits empty-string title/channel from the videos upsert (treats falsy as absent)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.single.mockResolvedValue({
      data: { id: "v1" },
      error: null,
    });
    mocks.transcriptsBuilder.upsert.mockReturnValueOnce(
      Promise.resolve({ error: null }) as unknown as typeof mocks.transcriptsBuilder
    );

    const { writeCachedTranscript } = await loadFresh();
    await writeCachedTranscript({
      ...baseTranscript,
      title: "",
      channelName: "",
    });

    const videosCall = mocks.videosBuilder.upsert.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(videosCall[0]).not.toHaveProperty("title");
    expect(videosCall[0]).not.toHaveProperty("channel_name");
  });

  it("throws when video upsert fails (so caller's .catch logs with context)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.single.mockResolvedValue({
      data: null,
      error: { message: "unique violation" },
    });

    const { writeCachedTranscript } = await loadFresh();
    await expect(writeCachedTranscript(baseTranscript)).rejects.toThrow(
      /video upsert failed: unique violation/
    );
    expect(mocks.transcriptsBuilder.upsert).not.toHaveBeenCalled();
  });

  it("throws when transcript upsert fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.single.mockResolvedValue({
      data: { id: "v1" },
      error: null,
    });
    mocks.transcriptsBuilder.upsert.mockReturnValueOnce(
      Promise.resolve({
        error: { message: "transcripts upsert blew up" },
      }) as unknown as typeof mocks.transcriptsBuilder
    );

    const { writeCachedTranscript } = await loadFresh();
    await expect(writeCachedTranscript(baseTranscript)).rejects.toThrow(
      /transcript upsert failed: transcripts upsert blew up/
    );
  });

  it("rejects empty segments array (invariant: never cache an empty transcript)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.videosBuilder.single.mockResolvedValue({
      data: { id: "v1" },
      error: null,
    });

    const { writeCachedTranscript } = await loadFresh();
    await expect(
      writeCachedTranscript({ ...baseTranscript, segments: [] })
    ).rejects.toThrow(/transcript write failed schema validation/);
    expect(mocks.transcriptsBuilder.upsert).not.toHaveBeenCalled();
  });
});
