import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createVideoChatSubjectResolver,
  type CanonicalVideoIdentity,
  type VideoChatSubject,
  type VideoChatSubjectAdapter,
} from "../video-chat-subject";
import {
  databaseVideoChatSubjectAdapter,
  createHeroDemoVideoChatSubjectAdapter,
  heroDemoVideoChatSubjectAdapter,
} from "../video-chat-subject-adapters";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));

const VIDEO_ID = "dQw4w9WgXcQ";
const HERO_VIDEO_ID = "Hrbq66XqtCo";
const DATABASE_VIDEO_ID = "video-uuid";

function identity(youtubeVideoId = VIDEO_ID): CanonicalVideoIdentity {
  return {
    youtubeVideoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
  };
}

function subject(
  source: VideoChatSubject["source"],
  canonicalIdentity: CanonicalVideoIdentity,
): VideoChatSubject {
  return {
    identity: canonicalIdentity,
    source,
  };
}

function makeAdapters() {
  const heroDemo: VideoChatSubjectAdapter = {
    kind: "hero_demo",
    resolve: vi.fn(async (canonicalIdentity) => ({
      status: "resolved" as const,
      subject: subject("hero_demo", canonicalIdentity),
    })),
  };
  const database: VideoChatSubjectAdapter = {
    kind: "database",
    resolve: vi.fn(async (canonicalIdentity) => ({
      status: "resolved" as const,
      subject: subject("database", canonicalIdentity),
    })),
  };
  return { heroDemo, database };
}

function installVideoLookup(result: unknown) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  mocks.getServiceRoleClient.mockReturnValue({ from });
  return { from, select, eq, maybeSingle };
}

function query(result: unknown) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const is = vi.fn().mockReturnValue({ maybeSingle });
  const eq = vi.fn().mockReturnValue({ maybeSingle, is });
  const select = vi.fn().mockReturnValue({ eq });
  return { select, eq, is, maybeSingle };
}

function installDatabaseGroundingLookup(overrides: {
  video?: unknown;
  transcript?: unknown;
  summary?: unknown;
} = {}) {
  const video = query(
    overrides.video ?? {
      data: {
        id: DATABASE_VIDEO_ID,
        title: "Database title",
        channel_name: "Database channel",
        language: "en",
      },
      error: null,
    },
  );
  const transcript = query(
    overrides.transcript ?? {
      data: {
        video_id: DATABASE_VIDEO_ID,
        segments: [{ text: "Transcript line", start: 1, duration: 2 }],
        transcript_source: "auto_captions",
        language: "en",
      },
      error: null,
    },
  );
  const summary = query(
    overrides.summary ?? {
      data: {
        video_id: DATABASE_VIDEO_ID,
        transcript: "Transcript snapshot",
        summary: "Native summary",
        transcript_source: "auto_captions",
        model: "summary-model",
        processing_time_seconds: 3,
        transcribe_time_seconds: 1,
        summarize_time_seconds: 2,
        output_language: null,
      },
      error: null,
    },
  );
  const from = vi.fn((table: string) => {
    if (table === "videos") return { select: video.select };
    if (table === "video_transcripts") return { select: transcript.select };
    if (table === "summaries") return { select: summary.select };
    throw new Error(`unexpected table ${table}`);
  });
  mocks.getServiceRoleClient.mockReturnValue({ from });
  return { from, video, transcript, summary };
}

describe("Video Chat Subject resolver", () => {
  beforeEach(() => {
    mocks.getServiceRoleClient.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("canonicalizes equivalent YouTube URL forms before selecting an adapter", async () => {
    const adapters = makeAdapters();
    const resolve = createVideoChatSubjectResolver(adapters);

    const equivalentUrls = [
      `https://www.youtube.com/watch?v=${VIDEO_ID}&t=30s`,
      `https://youtu.be/${VIDEO_ID}?si=tracking`,
      `https://m.youtube.com/embed/${VIDEO_ID}`,
      `https://music.youtube.com/shorts/${VIDEO_ID}`,
    ];

    for (const youtubeUrl of equivalentUrls) {
      const result = await resolve(youtubeUrl);
      expect(result.status).toBe("resolved");
    }

    expect(adapters.heroDemo.resolve).not.toHaveBeenCalled();
    expect(adapters.database.resolve).toHaveBeenCalledTimes(
      equivalentUrls.length,
    );
    for (const call of vi.mocked(adapters.database.resolve).mock.calls) {
      expect(call[0]).toEqual(identity());
    }
  });

  it("rejects an unresolvable URL without invoking either adapter", async () => {
    const adapters = makeAdapters();
    const resolve = createVideoChatSubjectResolver(adapters);

    await expect(resolve("https://www.youtube.com/watch?v=too-short")).resolves
      .toEqual({ status: "invalid" });

    expect(adapters.heroDemo.resolve).not.toHaveBeenCalled();
    expect(adapters.database.resolve).not.toHaveBeenCalled();
  });

  it("selects only the static adapter for an allowlisted Hero Demo", async () => {
    const adapters = makeAdapters();
    const resolve = createVideoChatSubjectResolver(adapters);

    const result = await resolve(
      `https://www.youtube.com/watch?v=${HERO_VIDEO_ID}`,
    );

    expect(result).toMatchObject({
      status: "resolved",
      subject: {
        identity: identity(HERO_VIDEO_ID),
        source: "hero_demo",
      },
    });
    expect(adapters.heroDemo.resolve).toHaveBeenCalledTimes(1);
    expect(adapters.database.resolve).not.toHaveBeenCalled();
  });

  it("does not fall back when the selected Hero Demo adapter is unavailable", async () => {
    const adapters = makeAdapters();
    vi.mocked(adapters.heroDemo.resolve).mockResolvedValueOnce({
      status: "unavailable",
    });
    const resolve = createVideoChatSubjectResolver(adapters);

    await expect(
      resolve(`https://www.youtube.com/watch?v=${HERO_VIDEO_ID}`),
    ).resolves.toEqual({
      status: "unavailable",
      identity: identity(HERO_VIDEO_ID),
    });

    expect(adapters.database.resolve).not.toHaveBeenCalled();
  });

  it("returns a stateless Hero Demo subject without retained capabilities", async () => {
    const result = await heroDemoVideoChatSubjectAdapter.resolve(
      identity(HERO_VIDEO_ID),
    );

    expect(result).toEqual({
      status: "resolved",
      subject: {
        identity: identity(HERO_VIDEO_ID),
        source: "hero_demo",
        grounding: { load: expect.any(Function) },
      },
    });
  });

  it("loads one coherent Hero Demo Grounding from one base asset and its source language", async () => {
    const loadBase = vi.fn().mockResolvedValue({
      id: HERO_VIDEO_ID,
      segments: [{ text: "Hola", start: 1, duration: 2 }],
      nativeLanguage: "es",
    });
    const loadSummary = vi.fn().mockResolvedValue({
      id: HERO_VIDEO_ID,
      language: "es",
      summary: "Resumen",
      model: "hero-model",
      suggestions: ["q1", "q2", "q3"],
    });
    const adapter = createHeroDemoVideoChatSubjectAdapter([
      {
        id: HERO_VIDEO_ID,
        title: "Hero title",
        channel: "Hero channel",
        durationSec: 60,
        loadBase,
        loadSummary,
      },
    ]);

    const result = await adapter.resolve(identity(HERO_VIDEO_ID));
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;

    const loads = await Promise.all([
      result.subject.grounding!.load(),
      result.subject.grounding!.load(),
    ]);
    expect(loads[0]).toEqual({
      status: "ready",
      grounding: {
        transcript: {
          videoId: HERO_VIDEO_ID,
          title: "Hero title",
          channelName: "Hero channel",
          segments: [{ text: "Hola", start: 1, duration: 2 }],
          transcriptSource: "auto_captions",
          language: "es",
        },
        summary: {
          videoId: HERO_VIDEO_ID,
          title: "Hero title",
          channelName: "Hero channel",
          language: "es",
          transcript: "",
          summary: "Resumen",
          transcriptSource: "auto_captions",
          model: "hero-model",
          processingTimeSeconds: 0,
          transcribeTimeSeconds: 0,
          summarizeTimeSeconds: 0,
          outputLanguage: null,
        },
      },
    });
    expect(loads[1]).toBe(loads[0]);
    expect(loadBase).toHaveBeenCalledTimes(1);
    expect(loadSummary).toHaveBeenCalledTimes(1);
    expect(loadSummary).toHaveBeenCalledWith("es");
  });

  it("does not fall back to a translated Summary when the Hero source language is unsupported", async () => {
    const loadBase = vi.fn().mockResolvedValue({
      id: HERO_VIDEO_ID,
      segments: [{ text: "line", start: 1, duration: 2 }],
      nativeLanguage: "xyz",
    });
    const loadSummary = vi.fn();
    const adapter = createHeroDemoVideoChatSubjectAdapter([
      {
        id: HERO_VIDEO_ID,
        title: "Hero title",
        channel: "Hero channel",
        durationSec: 60,
        loadBase,
        loadSummary,
      },
    ]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await adapter.resolve(identity(HERO_VIDEO_ID));
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    await expect(result.subject.grounding!.load()).resolves.toEqual({
      status: "unavailable",
    });
    expect(loadSummary).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[video-chat-subject] Hero Demo source language invalid",
      expect.objectContaining({
        errorId: "VIDEO_CHAT_SUBJECT_HERO_DEMO_SOURCE_LANGUAGE_INVALID",
      }),
    );
  });

  it("returns not-ready when the Hero base has no usable timing", async () => {
    const loadBase = vi.fn().mockResolvedValue({
      id: HERO_VIDEO_ID,
      segments: [{ text: "legacy", start: 0, duration: 0 }],
      nativeLanguage: "en",
    });
    const loadSummary = vi.fn();
    const adapter = createHeroDemoVideoChatSubjectAdapter([
      {
        id: HERO_VIDEO_ID,
        title: "Hero title",
        channel: "Hero channel",
        durationSec: 60,
        loadBase,
        loadSummary,
      },
    ]);

    const result = await adapter.resolve(identity(HERO_VIDEO_ID));
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    await expect(result.subject.grounding!.load()).resolves.toEqual({
      status: "not_ready",
    });
    expect(loadSummary).not.toHaveBeenCalled();
  });

  it("returns unavailable when the Hero Summary loader fails", async () => {
    const loadBase = vi.fn().mockResolvedValue({
      id: HERO_VIDEO_ID,
      segments: [{ text: "line", start: 1, duration: 2 }],
      nativeLanguage: "en",
    });
    const loadSummary = vi.fn().mockRejectedValue(new Error("chunk-fetch"));
    const adapter = createHeroDemoVideoChatSubjectAdapter([
      {
        id: HERO_VIDEO_ID,
        title: "Hero title",
        channel: "Hero channel",
        durationSec: 60,
        loadBase,
        loadSummary,
      },
    ]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await adapter.resolve(identity(HERO_VIDEO_ID));
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    await expect(result.subject.grounding!.load()).resolves.toEqual({
      status: "unavailable",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "[video-chat-subject] Hero Demo Summary load failed",
      expect.objectContaining({ errorId: "HERO_DEMO_SUMMARY_LOAD_FAILED" }),
    );
  });

  it("returns unavailable for Hero registry drift", async () => {
    const adapter = createHeroDemoVideoChatSubjectAdapter([]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await adapter.resolve(identity(HERO_VIDEO_ID));
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    await expect(result.subject.grounding!.load()).resolves.toEqual({
      status: "unavailable",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "[video-chat-subject] Hero Demo registry drift",
      expect.objectContaining({ errorId: "HERO_DEMO_REGISTRY_DRIFT" }),
    );
  });

  it("selects only the database adapter for a non-demo video", async () => {
    const adapters = makeAdapters();
    const resolve = createVideoChatSubjectResolver(adapters);

    const result = await resolve(
      `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    );

    expect(result).toMatchObject({
      status: "resolved",
      subject: {
        identity: identity(),
        source: "database",
      },
    });
    expect(adapters.database.resolve).toHaveBeenCalledTimes(1);
    expect(adapters.heroDemo.resolve).not.toHaveBeenCalled();
  });

  it("represents retained-thread, entitlement, and suggestion-cache targets independently", async () => {
    const lookup = installVideoLookup({
      data: {
        id: DATABASE_VIDEO_ID,
        title: "Database title",
        channel_name: "Database channel",
        language: "en",
      },
      error: null,
    });

    const result = await databaseVideoChatSubjectAdapter.resolve(identity());

    expect(result).toMatchObject({
      status: "resolved",
      subject: {
        identity: identity(),
        source: "database",
        retainedThread: { videoId: DATABASE_VIDEO_ID },
        entitlement: { videoId: DATABASE_VIDEO_ID },
        suggestionCache: { videoId: DATABASE_VIDEO_ID },
        grounding: { load: expect.any(Function) },
      },
    });
    if (result.status === "resolved") {
      expect(result.subject.retainedThread).not.toBe(
        result.subject.entitlement,
      );
      expect(result.subject.entitlement).not.toBe(
        result.subject.suggestionCache,
      );
    }
    expect(lookup.from).toHaveBeenCalledWith("videos");
    expect(lookup.select).toHaveBeenCalledWith(
      "id, title, channel_name, language",
    );
    expect(lookup.eq).toHaveBeenCalledWith("url_hash", VIDEO_ID);
  });

  it("loads one coherent database Grounding lazily from the shared Video UUID", async () => {
    const lookup = installDatabaseGroundingLookup();

    const result = await databaseVideoChatSubjectAdapter.resolve(identity());

    expect(lookup.from).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;

    expect(result.subject.retainedThread?.videoId).toBe(DATABASE_VIDEO_ID);
    expect(result.subject.entitlement?.videoId).toBe(DATABASE_VIDEO_ID);
    expect(result.subject.suggestionCache?.videoId).toBe(DATABASE_VIDEO_ID);
    expect(result.subject.grounding).toBeDefined();

    const grounding = await result.subject.grounding!.load();

    expect(grounding).toEqual({
      status: "ready",
      grounding: {
        transcript: {
          videoId: DATABASE_VIDEO_ID,
          title: "Database title",
          channelName: "Database channel",
          segments: [{ text: "Transcript line", start: 1, duration: 2 }],
          transcriptSource: "auto_captions",
          language: "en",
        },
        summary: {
          videoId: DATABASE_VIDEO_ID,
          title: "Database title",
          channelName: "Database channel",
          language: "en",
          transcript: "Transcript snapshot",
          summary: "Native summary",
          transcriptSource: "auto_captions",
          model: "summary-model",
          processingTimeSeconds: 3,
          transcribeTimeSeconds: 1,
          summarizeTimeSeconds: 2,
          outputLanguage: null,
        },
      },
    });
    expect(lookup.from).toHaveBeenCalledTimes(3);
    expect(lookup.transcript.eq).toHaveBeenCalledWith(
      "video_id",
      DATABASE_VIDEO_ID,
    );
    expect(lookup.summary.eq).toHaveBeenCalledWith(
      "video_id",
      DATABASE_VIDEO_ID,
    );
    expect(lookup.summary.is).toHaveBeenCalledWith("output_language", null);
  });

  it("memoizes Grounding reads for a resolved database subject", async () => {
    const lookup = installDatabaseGroundingLookup();
    const result = await databaseVideoChatSubjectAdapter.resolve(identity());

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;

    const loads = await Promise.all([
      result.subject.grounding!.load(),
      result.subject.grounding!.load(),
      result.subject.grounding!.load(),
    ]);

    expect(loads[0]).toBe(loads[1]);
    expect(loads[1]).toBe(loads[2]);
    expect(lookup.from).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["Transcript", { data: null, error: null }, undefined],
    [
      "Summary",
      undefined,
      { data: null, error: null },
    ],
    [
      "translated-only Summary",
      undefined,
      {
        data: {
          video_id: DATABASE_VIDEO_ID,
          transcript: "Transcript snapshot",
          summary: "Translated summary",
          transcript_source: "auto_captions",
          model: "summary-model",
          processing_time_seconds: 3,
          transcribe_time_seconds: 1,
          summarize_time_seconds: 2,
          output_language: "es",
        },
        error: null,
      },
    ],
  ])(
    "returns not-ready when %s is absent or not the source-language artifact",
    async (_label, transcript, summary) => {
      installDatabaseGroundingLookup({ transcript, summary });
      const result = await databaseVideoChatSubjectAdapter.resolve(identity());

      expect(result.status).toBe("resolved");
      if (result.status !== "resolved") return;
      await expect(result.subject.grounding!.load()).resolves.toEqual({
        status: "not_ready",
      });
    },
  );

  it.each([
    ["Transcript read", { data: null, error: { code: "TRANSCRIPT_DOWN" } }, undefined],
    ["Summary read", undefined, { data: null, error: { code: "SUMMARY_DOWN" } }],
  ])("returns unavailable when the %s fails", async (_label, transcript, summary) => {
    installDatabaseGroundingLookup({ transcript, summary });
    const result = await databaseVideoChatSubjectAdapter.resolve(identity());

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    await expect(result.subject.grounding!.load()).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("returns unavailable for a Grounding schema mismatch", async () => {
    installDatabaseGroundingLookup({
      transcript: {
        data: {
          video_id: DATABASE_VIDEO_ID,
          segments: [{ text: 123, start: 1, duration: 2 }],
          transcript_source: "auto_captions",
          language: "en",
        },
        error: null,
      },
    });
    const result = await databaseVideoChatSubjectAdapter.resolve(identity());

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    await expect(result.subject.grounding!.load()).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("returns unavailable when the Summary row fails validation", async () => {
    installDatabaseGroundingLookup({
      summary: {
        data: {
          video_id: DATABASE_VIDEO_ID,
          transcript: "Transcript snapshot",
          summary: 123,
          transcript_source: "auto_captions",
          model: "summary-model",
          processing_time_seconds: 3,
          transcribe_time_seconds: 1,
          summarize_time_seconds: 2,
          output_language: null,
        },
        error: null,
      },
    });
    const result = await databaseVideoChatSubjectAdapter.resolve(identity());

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    await expect(result.subject.grounding!.load()).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("returns not-ready when the database Video is absent", async () => {
    installVideoLookup({ data: null, error: null });

    await expect(
      databaseVideoChatSubjectAdapter.resolve(identity()),
    ).resolves.toEqual({ status: "not_ready" });
  });

  it("returns unavailable when the database Video row fails validation", async () => {
    installVideoLookup({
      data: {
        id: 123,
        title: "Database title",
        channel_name: "Database channel",
        language: "en",
      },
      error: null,
    });

    await expect(
      databaseVideoChatSubjectAdapter.resolve(identity()),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("returns unavailable for a database source failure without exposing the error", async () => {
    installVideoLookup({
      data: null,
      error: { message: "private database details", code: "PGRST000" },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      databaseVideoChatSubjectAdapter.resolve(identity()),
    ).resolves.toEqual({ status: "unavailable" });

    expect(errorSpy).toHaveBeenCalledWith(
      "[video-chat-subject] database lookup failed",
      expect.objectContaining({
        errorId: "VIDEO_CHAT_SUBJECT_DATABASE_LOOKUP_FAILED",
        videoId: VIDEO_ID,
        errorClass: "SupabaseError",
      }),
    );
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain(
      "private database details",
    );
  });

  it("returns unavailable when the database client is not configured", async () => {
    mocks.getServiceRoleClient.mockReturnValue(null);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      databaseVideoChatSubjectAdapter.resolve(identity()),
    ).resolves.toEqual({ status: "unavailable" });

    expect(errorSpy).toHaveBeenCalledWith(
      "[video-chat-subject] database client unavailable",
      expect.objectContaining({
        errorId: "VIDEO_CHAT_SUBJECT_DATABASE_UNAVAILABLE",
        videoId: VIDEO_ID,
      }),
    );
  });
});
