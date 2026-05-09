import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HERO_ID = "Hrbq66XqtCo";
const NON_DEMO_ID = "dQw4w9WgXcQ";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    samples: [
      {
        // Inlined because vi.hoisted runs before module-body consts.
        id: "Hrbq66XqtCo",
        title: "Will Nvidia's moat persist?",
        channel: "Test Channel",
        durationSec: 1800,
        loadBase: vi.fn(),
        loadSummary: vi.fn(),
      },
    ],
  },
}));

vi.mock("server-only", () => ({}));

vi.mock("@/app/components/hero-demo-data", () => ({
  get SAMPLES() {
    return mocks.samples;
  },
}));

describe("hero-demo-chat helpers", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.samples[0].loadBase.mockReset();
    mocks.samples[0].loadSummary.mockReset();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("loadHeroDemoSummary", () => {
    it("returns null for a non-demo URL with no log (caller misuse)", async () => {
      const { loadHeroDemoSummary } = await import("../hero-demo-chat");
      const res = await loadHeroDemoSummary(
        `https://www.youtube.com/watch?v=${NON_DEMO_ID}`,
      );
      expect(res).toBeNull();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(mocks.samples[0].loadBase).not.toHaveBeenCalled();
    });

    it("returns null and logs HERO_DEMO_BASE_LOAD_FAILED when loadBase rejects", async () => {
      mocks.samples[0].loadBase.mockRejectedValueOnce(new Error("chunk-fetch"));
      const { loadHeroDemoSummary } = await import("../hero-demo-chat");
      const res = await loadHeroDemoSummary(
        `https://www.youtube.com/watch?v=${HERO_ID}`,
      );
      expect(res).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("base load failed"),
        expect.objectContaining({
          errorId: "HERO_DEMO_BASE_LOAD_FAILED",
          videoId: HERO_ID,
        }),
      );
      // Critical: loadSummary must NOT fire when loadBase failed —
      // base failures shouldn't double-log under the summary id.
      expect(mocks.samples[0].loadSummary).not.toHaveBeenCalled();
    });

    it("returns null and logs HERO_DEMO_SUMMARY_LOAD_FAILED with lang context when loadSummary rejects", async () => {
      mocks.samples[0].loadBase.mockResolvedValueOnce({
        id: HERO_ID,
        segments: [{ text: "x", start: 0, duration: 1 }],
        nativeLanguage: "en",
      });
      mocks.samples[0].loadSummary.mockRejectedValueOnce(
        new Error("missing-translation"),
      );
      const { loadHeroDemoSummary } = await import("../hero-demo-chat");
      const res = await loadHeroDemoSummary(
        `https://www.youtube.com/watch?v=${HERO_ID}`,
      );
      expect(res).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("summary load failed"),
        expect.objectContaining({
          errorId: "HERO_DEMO_SUMMARY_LOAD_FAILED",
          videoId: HERO_ID,
          lang: "en",
          nativeLanguage: "en",
        }),
      );
    });

    it("falls back to 'en' when nativeLanguage is outside SUPPORTED_LANGUAGE_CODES", async () => {
      mocks.samples[0].loadBase.mockResolvedValueOnce({
        id: HERO_ID,
        segments: [],
        // "xyz" is deliberately bogus to exercise the fallback branch.
        nativeLanguage: "xyz",
      });
      mocks.samples[0].loadSummary.mockResolvedValueOnce({
        id: HERO_ID,
        language: "en",
        summary: "S",
        model: "m",
        suggestions: ["a", "b", "c"],
      });
      const { loadHeroDemoSummary } = await import("../hero-demo-chat");
      const res = await loadHeroDemoSummary(
        `https://www.youtube.com/watch?v=${HERO_ID}`,
      );
      expect(res).not.toBeNull();
      expect(mocks.samples[0].loadSummary).toHaveBeenCalledWith("en");
    });

    it("uses nativeLanguage when it is in SUPPORTED_LANGUAGE_CODES", async () => {
      mocks.samples[0].loadBase.mockResolvedValueOnce({
        id: HERO_ID,
        segments: [],
        nativeLanguage: "zh",
      });
      mocks.samples[0].loadSummary.mockResolvedValueOnce({
        id: HERO_ID,
        language: "zh",
        summary: "摘要",
        model: "m",
        suggestions: ["a", "b", "c"],
      });
      const { loadHeroDemoSummary } = await import("../hero-demo-chat");
      const res = await loadHeroDemoSummary(
        `https://www.youtube.com/watch?v=${HERO_ID}`,
      );
      expect(res).not.toBeNull();
      expect(mocks.samples[0].loadSummary).toHaveBeenCalledWith("zh");
      // The route uses `videoId` for downstream logging — pin it to the
      // YouTube id, not a UUID.
      expect(res?.videoId).toBe(HERO_ID);
    });

    it("returns null and logs HERO_DEMO_REGISTRY_DRIFT when allowlist matches but SAMPLES misses", async () => {
      // Mutate the in-test registry to simulate drift: id is in the
      // allowlist (still hardcoded into hero-demo-ids.ts) but not in
      // SAMPLES.
      const original = mocks.samples.splice(0, mocks.samples.length);
      try {
        const { loadHeroDemoSummary } = await import("../hero-demo-chat");
        const res = await loadHeroDemoSummary(
          `https://www.youtube.com/watch?v=${HERO_ID}`,
        );
        expect(res).toBeNull();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("missing from SAMPLES registry"),
          expect.objectContaining({
            errorId: "HERO_DEMO_REGISTRY_DRIFT",
            videoId: HERO_ID,
          }),
        );
      } finally {
        mocks.samples.push(...original);
      }
    });
  });

  describe("loadHeroDemoTranscript", () => {
    it("returns null for a non-demo URL", async () => {
      const { loadHeroDemoTranscript } = await import("../hero-demo-chat");
      const res = await loadHeroDemoTranscript(
        `https://www.youtube.com/watch?v=${NON_DEMO_ID}`,
      );
      expect(res).toBeNull();
      expect(mocks.samples[0].loadBase).not.toHaveBeenCalled();
    });

    it("returns the registry segments and pins videoId to the YouTube id", async () => {
      const segments = [
        { text: "Hello.", start: 0, duration: 1 },
        { text: "World.", start: 1, duration: 2 },
      ];
      mocks.samples[0].loadBase.mockResolvedValueOnce({
        id: HERO_ID,
        segments,
        nativeLanguage: "en",
      });
      const { loadHeroDemoTranscript } = await import("../hero-demo-chat");
      const res = await loadHeroDemoTranscript(
        `https://www.youtube.com/watch?v=${HERO_ID}`,
      );
      expect(res).not.toBeNull();
      expect(res?.videoId).toBe(HERO_ID);
      expect(res?.segments).toEqual(segments);
    });

    it("returns null and logs HERO_DEMO_BASE_LOAD_FAILED when loadBase rejects (same id as the summary path)", async () => {
      // The shared error id is intentional — both helpers separately
      // call loadBase, but a broken base chunk should be one Sentry
      // incident, not two.
      mocks.samples[0].loadBase.mockRejectedValueOnce(new Error("chunk-fetch"));
      const { loadHeroDemoTranscript } = await import("../hero-demo-chat");
      const res = await loadHeroDemoTranscript(
        `https://www.youtube.com/watch?v=${HERO_ID}`,
      );
      expect(res).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("base load failed"),
        expect.objectContaining({
          errorId: "HERO_DEMO_BASE_LOAD_FAILED",
          videoId: HERO_ID,
        }),
      );
    });
  });
});
