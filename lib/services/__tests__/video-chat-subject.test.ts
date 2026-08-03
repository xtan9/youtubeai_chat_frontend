import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createVideoChatSubjectResolver,
  type CanonicalVideoIdentity,
  type VideoChatSubject,
  type VideoChatSubjectAdapter,
} from "../video-chat-subject";
import {
  databaseVideoChatSubjectAdapter,
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
      },
    });
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
      data: { id: DATABASE_VIDEO_ID },
      error: null,
    });

    const result = await databaseVideoChatSubjectAdapter.resolve(identity());

    expect(result).toEqual({
      status: "resolved",
      subject: {
        identity: identity(),
        source: "database",
        retainedThread: { videoId: DATABASE_VIDEO_ID },
        entitlement: { videoId: DATABASE_VIDEO_ID },
        suggestionCache: { videoId: DATABASE_VIDEO_ID },
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
    expect(lookup.select).toHaveBeenCalledWith("id");
    expect(lookup.eq).toHaveBeenCalledWith("url_hash", VIDEO_ID);
  });

  it("returns not-ready when the database Video is absent", async () => {
    installVideoLookup({ data: null, error: null });

    await expect(
      databaseVideoChatSubjectAdapter.resolve(identity()),
    ).resolves.toEqual({ status: "not_ready" });
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
