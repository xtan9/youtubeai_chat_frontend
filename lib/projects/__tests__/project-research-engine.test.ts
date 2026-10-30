import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { stream, search } = vi.hoisted(() => ({
  stream: vi.fn(),
  search: vi.fn(),
}));
vi.mock("@/lib/services/llm-chat-client", () => ({
  streamChatCompletion: stream,
}));
vi.mock("@/lib/services/research-literature", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/services/research-literature")
  >()),
  searchResearchLiterature: search,
}));
import { ChatGatewayError } from "@/lib/services/llm-chat-error";
import { runProjectResearch } from "../project-research-engine";
import type {
  ResearchDocument,
  ResearchEvidence,
} from "../project-research-contract";
const external: ResearchEvidence = {
  id: "E1234567890123456",
  kind: "publication_abstract",
  originId: "10.1/trial",
  title: "Diet trial",
  url: "https://europepmc.org/article/MED/123",
  text: "This human trial did not establish long term effects.",
  retrievedAt: "2026-10-29T00:00:00.000Z",
  year: "2024",
  authors: "A Author",
  publicationTypes: ["Randomized Controlled Trial"],
};
const observation = {
  text: "The available human trial leaves long-term effects unresolved.",
  references: [{ id: external.id, quote: external.text }],
};
const synthesis = {
  judgment: observation,
  findings: [observation],
  reasoning: observation,
  changes: "This establishes an initial judgment.",
  uncertainties: ["Are longer trials available?"],
  nextSteps: ["Find longer human trials."],
};
const args = {
  name: "Seed oils",
  goal: "Show they kill",
  question: "种子油真的有害吗？",
  previous: null,
  artifacts: {
    sourceManifest: {
      projectId: "10000000-0000-4000-8000-000000000001",
      sourceSetRevision: 1,
      sources: [],
    },
    sourceCoverage: {
      totalVideos: 0,
      readyVideos: 0,
      unavailableVideos: [],
      passagesExamined: 0,
      usedVideos: 0,
      passagesUsed: 0,
    },
    evidenceSnapshot: {
      projectId: "10000000-0000-4000-8000-000000000001",
      sourceSetRevision: 1,
      passages: [],
    },
  },
  signal: new AbortController().signal,
  onUsage: vi.fn(),
};
const plan = {
  queries: [
    { query: "linoleic acid human trials", purpose: "Test human outcomes" },
    {
      query: "linoleic acid systematic review",
      purpose: "Check complementary evidence",
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  search.mockResolvedValue([external]);
  let calls = 0;
  stream.mockImplementation(async function* () {
    yield {
      type: "delta",
      text: JSON.stringify(calls++ === 0 ? plan : synthesis),
    };
    yield {
      type: "usage",
      usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 },
    };
  });
});
describe("active project research", () => {
  it("plans complementary external searches, deduplicates publications and binds a judgment to abstracts", async () => {
    const result = await runProjectResearch(args);
    expect(search).toHaveBeenCalledTimes(2);
    expect(result.evidence).toHaveLength(1);
    expect(result.synthesis.judgment).toEqual(observation);
    expect(result.searches).toHaveLength(2);
    expect(args.onUsage).toHaveBeenCalledTimes(2);
  });
  it("uses previous judgment and fresh searches on a follow-up", async () => {
    const previous = await runProjectResearch(args);
    vi.clearAllMocks();
    let calls = 0;
    stream.mockImplementation(async function* () {
      yield {
        type: "delta",
        text: JSON.stringify(
          calls++ === 0
            ? plan
            : {
                ...synthesis,
                changes: "The judgment remains qualified after another search.",
              },
        ),
      };
    });
    const result = await runProjectResearch({
      ...args,
      question: "那长期研究呢？",
      previous,
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(stream.mock.calls[0][0].messages[0].content).toContain(
      previous.synthesis.judgment.text,
    );
    expect(result.synthesis.changes).toContain("remains qualified");
  });
  it("does not publish an update if every external search fails", async () => {
    search.mockRejectedValue(new Error("private provider error"));
    await expect(runProjectResearch(args)).rejects.toThrow(
      "literature_provider_unavailable",
    );
    expect(stream).toHaveBeenCalledOnce();
  });
  it("reports partial search coverage instead of calling it an exhaustive search", async () => {
    search.mockRejectedValueOnce(new Error("unavailable"));
    expect((await runProjectResearch(args)).warnings.join(" ")).toContain(
      "partial search coverage",
    );
  });
  it("repairs once, then rejects invented citations", async () => {
    let calls = 0;
    stream.mockImplementation(async function* () {
      yield {
        type: "delta",
        text: JSON.stringify(
          calls++ === 0
            ? plan
            : {
                ...synthesis,
                judgment: {
                  ...observation,
                  references: [
                    { id: "E0000000000000000", quote: external.text },
                  ],
                },
              },
        ),
      };
    });
    await expect(runProjectResearch(args)).rejects.toThrow("unknown_reference");
    expect(stream).toHaveBeenCalledTimes(3);
  });
});
export const researchFixture: ResearchDocument = {
  question: args.question,
  synthesis,
  evidence: [external],
  searches: [],
  warnings: [],
  sourceSetRevision: 1,
  promptVersion: "project-research-v1",
};

it("does not make removed historical video passages citable in a new source revision", async () => {
  const previous = {
    ...researchFixture,
    evidence: [
      external,
      {
        ...external,
        id: "V1234567890123456",
        kind: "video" as const,
        originId: "removed-video:1",
        url: "https://www.youtube.com/watch?v=removed0001&t=0s",
      },
    ],
  };
  const result = await runProjectResearch({ ...args, previous });
  expect(result.evidence.every((item) => item.kind !== "video")).toBe(true);
  expect(result.warnings.join(" ")).toContain(
    "No relevant project video passages",
  );
});

it("retries one malformed external plan before any literature request", async () => {
  let calls = 0;
  stream.mockImplementation(async function* () {
    const call = calls++;
    yield {
      type: "delta",
      text: call === 0 ? "" : JSON.stringify(call === 1 ? plan : synthesis),
    };
  });
  expect((await runProjectResearch(args)).synthesis.judgment).toEqual(
    observation,
  );
  expect(stream).toHaveBeenCalledTimes(3);
  expect(search).toHaveBeenCalledTimes(2);
});
it("accepts complete fenced JSON while retaining strict plan and citation validation", async () => {
  let calls = 0;
  stream.mockImplementation(async function* () {
    yield {
      type: "delta",
      text:
        "```json\n" +
        JSON.stringify(calls++ === 0 ? plan : synthesis) +
        "\n```",
    };
  });
  expect((await runProjectResearch(args)).synthesis.judgment).toEqual(
    observation,
  );
});
it("stops after two invalid plans without external requests", async () => {
  stream.mockImplementation(async function* () {
    yield { type: "delta", text: "not JSON" };
  });
  await expect(runProjectResearch(args)).rejects.toThrow();
  expect(stream).toHaveBeenCalledTimes(2);
  expect(search).not.toHaveBeenCalled();
});

it("keeps complete video text for synthesis without sending it through the query planner", async () => {
  const text = "COMPLETE_VIDEO_CONTEXT ".repeat(90);
  const passage = {
    passageId: "video:1-24:0:1980",
    videoId: "20000000-0000-4000-8000-000000000001",
    youtubeVideoId: "seedOil0001",
    title: "Seed oil trial",
    channelName: null,
    text,
    segmentOrdinal: 1,
    endSegmentOrdinal: 24,
    excerptStartCharacter: 0,
    excerptEndCharacter: text.length,
    startSeconds: 0,
    endSeconds: 60,
    language: "en",
    truncatedStart: false,
    truncatedEnd: false,
  };
  const result = await runProjectResearch({
    ...args,
    artifacts: {
      ...args.artifacts,
      evidenceSnapshot: {
        ...args.artifacts.evidenceSnapshot,
        passages: [passage],
      },
    },
  });
  expect(stream.mock.calls[0][0].messages[0].content).not.toContain(text);
  expect(stream.mock.calls[0][0].messages[0].content).toContain(
    text.slice(0, 240),
  );
  expect(stream.mock.calls[0][0].messages[0].content.length).toBeLessThan(6500);
  expect(stream.mock.calls[1][0].messages[0].content).toContain(text);
  expect(result.evidence.some((item) => item.text === text)).toBe(true);
});
it("recovers one internal planning timeout without starting extra literature searches", async () => {
  let calls = 0;
  stream.mockImplementation(async function* () {
    const call = calls++;
    if (call === 0) throw new DOMException("Timed out", "TimeoutError");
    yield {
      type: "delta",
      text: JSON.stringify(call === 1 ? plan : synthesis),
    };
  });
  expect((await runProjectResearch(args)).synthesis.judgment).toEqual(
    observation,
  );
  expect(stream).toHaveBeenCalledTimes(3);
  expect(search).toHaveBeenCalledTimes(2);
});

it("does not retry cancellation while planning", async () => {
  const controller = new AbortController();
  stream.mockImplementation(async function* () {
    controller.abort();
    if (controller.signal.aborted)
      throw new DOMException("Timed out", "TimeoutError");
    yield { type: "done" };
  });
  await expect(
    runProjectResearch({ ...args, signal: controller.signal }),
  ).rejects.toThrow();
  expect(stream).toHaveBeenCalledOnce();
  expect(search).not.toHaveBeenCalled();
});
it.each([401, 429, 503])(
  "keeps external planning recovery bounded for provider HTTP %i",
  async (status) => {
    let calls = 0;
    stream.mockImplementation(async function* () {
      const call = calls++;
      if (call === 0) throw new ChatGatewayError("provider_http_error", status);
      yield {
        type: "delta",
        text: JSON.stringify(call === 1 ? plan : synthesis),
      };
    });
    if (status === 401) {
      await expect(runProjectResearch(args)).rejects.toThrow();
      expect(stream).toHaveBeenCalledOnce();
      expect(search).not.toHaveBeenCalled();
    } else {
      expect((await runProjectResearch(args)).synthesis.judgment).toEqual(
        observation,
      );
      expect(stream).toHaveBeenCalledTimes(3);
    }
  },
);

it.each([
  {
    queries: [
      {
        query:
          '"linoleic acid" AND "saturated fat" AND ("cardiovascular mortality" OR "coronary events") AND ("randomized controlled trial" OR "systematic review") AND ("long term" OR followup)',
        purpose: "长期结局",
      },
    ],
  },
  { queries: ["linoleic acid cardiovascular mortality trials"] },
  { queries: [{ query: "linoleic acid long term trials", language: "en" }] },
])(
  "uses bounded valid search terms without requiring verbose planner metadata",
  async (candidate) => {
    let calls = 0;
    stream.mockImplementation(async function* () {
      yield {
        type: "delta",
        text: JSON.stringify(calls++ === 0 ? candidate : synthesis),
      };
    });
    const result = await runProjectResearch(args);
    expect(result.synthesis.judgment).toEqual(observation);
    expect(search).toHaveBeenCalledOnce();
    expect(result.searches[0].query.length).toBeLessThanOrEqual(500);
  },
);
it("rejects a plan that exceeds the three-search call budget", async () => {
  stream.mockImplementation(async function* () {
    yield {
      type: "delta",
      text: JSON.stringify({
        queries: Array.from({ length: 4 }, () => ({
          query: "linoleic acid trials",
          purpose: "Related research",
        })),
      }),
    };
  });
  await expect(runProjectResearch(args)).rejects.toThrow();
  expect(stream).toHaveBeenCalledTimes(2);
  expect(search).not.toHaveBeenCalled();
});
