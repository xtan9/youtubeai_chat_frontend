import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { retrieveProjectResearchEvidence } from "../project-research-retrieval";
import { passage } from "./project-grounded-test-fixtures";
import { buildProjectAnswerArtifacts } from "../project-grounded-evidence";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function gateway(content: string) {
  vi.stubEnv("LLM_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("LLM_GATEWAY_API_KEY", "test-key");
  const fetch = vi.fn().mockResolvedValue(new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content } }], usage: { prompt_tokens: 30, completion_tokens: 12 } })}\n\ndata: [DONE]\n\n`,
  ));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const coverage = { totalVideos: 1, readyVideos: 1, unavailableVideos: [], passagesExamined: 1 };
const noResults = { status: "no_results" as const, sourceSetRevision: 10, sourceLanguages: ["en"], coverage, passages: [] };

describe("Project research retrieval", () => {
  it("plans complementary evidence facets for a broad single-language research brief", async () => {
    const queries = ["randomized trials metaanalysis inflammation", "seed oils health", "heated oils oxidation prolonged heating"];
    const fetch = gateway(JSON.stringify({ queries: queries.map((query) => ({ language: "en", query })) }));
    const sources = [
      passage({ segmentOrdinal: 125, text: "The trial compares the measured result with the control group." }),
      passage({ segmentOrdinal: 1, text: "The speaker introduces seed oils and the proposed mechanism." }),
      passage({ segmentOrdinal: 253, text: "Prolonged repeated heating qualifies the conclusion." }),
    ];
    const search = vi.fn().mockImplementation(async ({ query }) => {
      const index = queries.indexOf(query);
      return index < 0 ? noResults : { ...noResults, status: "ready", passages: [sources[index]] };
    });
    const result = await retrieveProjectResearchEvidence({
      passageSearch: { search }, question: "为种子油研究生成中立简报，比较证据和限制。",
      signal: new AbortController().signal, onUsage: vi.fn(),
    });
    expect(result).toMatchObject({ status: "ready", passages: sources });
    expect(search).toHaveBeenCalledTimes(4);
    const prompt = JSON.parse(fetch.mock.calls[0][1].body).messages[0].content;
    expect(prompt).toContain("up to three complementary queries");
    expect(prompt).toContain("Do not repeat the same broad topic words in every query");
    expect(prompt).toContain("Put the concrete findings query first");
  });

  it("keeps findings from all five sources in the final eight passages before filling other facets", async () => {
    const queries = ["study results", "topic introduction", "evidence limitations"];
    gateway(JSON.stringify({ queries: queries.map((query) => ({ language: "en", query })) }));
    const findings = Array.from({ length: 5 }, (_, index) => passage({
      videoId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      segmentOrdinal: 101, startSeconds: 200, endSeconds: 220,
      text: `Source ${index + 1} reports its measured finding and comparison.`,
    }));
    const introductions = findings.toReversed().map((source) => passage({ ...source,
      passageId: `${source.videoId}:1:0:15`, segmentOrdinal: 1,
      text: "Topic overview.", excerptEndCharacter: 15,
    }));
    const limitations = [...findings.slice(1), findings[0]].map((source) => passage({ ...source,
      passageId: `${source.videoId}:201:0:18`, segmentOrdinal: 201,
      text: "Limited follow-up.", excerptEndCharacter: 18,
    }));
    const initial = { ...noResults, coverage: { ...coverage, totalVideos: 5, readyVideos: 5, passagesExamined: 100 } };
    const search = vi.fn().mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ ...initial, status: "ready", passages: findings })
      .mockResolvedValueOnce({ ...initial, status: "ready", passages: introductions })
      .mockResolvedValueOnce({ ...initial, status: "ready", passages: limitations });
    const result = await retrieveProjectResearchEvidence({
      passageSearch: { search }, question: "比较这些来源的研究证据与限制。",
      signal: new AbortController().signal, onUsage: vi.fn(),
    });
    if (result.status !== "ready") throw new Error("Expected ready evidence");
    const artifacts = buildProjectAnswerArtifacts({
      projectId: "10000000-0000-4000-8000-000000000001", goal: "比较研究证据与限制", search: result, balanceSources: true,
    });
    expect(artifacts.evidenceSnapshot.passages).toHaveLength(8);
    expect(artifacts.sourceManifest.sources).toHaveLength(5);
    for (const finding of findings) expect(artifacts.evidenceSnapshot.passages).toContainEqual(finding);
  });

  it("bounds a single language to three facets within the five-query budget", async () => {
    gateway(JSON.stringify({ queries: ["topic terms", "study results", "contrary evidence", "extra facet"].map((query) => ({ language: "en", query })) }));
    const search = vi.fn().mockResolvedValue(noResults);
    await expect(retrieveProjectResearchEvidence({
      passageSearch: { search }, question: "生成研究简报", signal: new AbortController().signal, onUsage: vi.fn(),
    })).rejects.toThrow("Research retrieval");
    expect(search).toHaveBeenCalledOnce();
  });

  it("retrieves original English evidence for a Chinese research question", async () => {
    const fetch = gateway(JSON.stringify({ queries: [{ language: "en", query: "seed oils health evidence" }] }));
    const source = passage({ text: "Seed oils health evidence is discussed in this source." });
    const search = vi.fn().mockImplementation(async ({ query }) => query === "seed oils health evidence"
      ? { ...noResults, status: "ready", passages: [source] }
      : noResults);
    const onUsage = vi.fn();

    const result = await retrieveProjectResearchEvidence({
      passageSearch: { search },
      question: "我想确定种子油是否对健康不好，而不是只找支持我的观点的内容。",
      signal: new AbortController().signal,
      onUsage,
    });

    expect(result).toMatchObject({ status: "ready", passages: [source], sourceSetRevision: 10 });
    expect(search).toHaveBeenLastCalledWith({ query: "seed oils health evidence", limit: 10, balanceSources: true });
    const sent = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sent.messages[0].content).toContain('"en"');
    expect(sent.messages[0].content).toContain("我想确定种子油");
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 30, cachedInputTokens: 0, outputTokens: 12 });
  });

  it("resolves a short follow-up using bounded conversation context without treating a leading project title as fact", async () => {
    const fetch = gateway(JSON.stringify({ queries: [{ language: "en", query: "seed oils contrary evidence" }] }));
    const source = passage({ text: "This source discusses contrary evidence about seed oils." });
    const search = vi.fn().mockResolvedValueOnce(noResults).mockResolvedValueOnce({ ...noResults, status: "ready", passages: [source] });
    const result = await retrieveProjectResearchEvidence({
      passageSearch: { search }, question: "那反方怎么说？", projectName: "Seed oil is killing you",
      history: [
        { role: "user", content: "过早的无关聊天".repeat(2_000) },
        { role: "user", content: "我想研究种子油是否有害。" },
        { role: "assistant", content: "有几个不同观点需要比较。" },
      ],
      signal: new AbortController().signal, onUsage: vi.fn(),
    });
    expect(result).toMatchObject({ status: "ready", passages: [source] });
    const prompt = JSON.parse(fetch.mock.calls[0][1].body).messages[0].content;
    expect(prompt).toContain("我想研究种子油是否有害");
    expect(prompt).toContain("那反方怎么说");
    expect(prompt).toContain("never treat their claims as evidence");
    expect(prompt.length).toBeLessThan(9_000);
  });

  it("can identify a generic comparison topic from source titles when the project is untitled", async () => {
    const fetch = gateway(JSON.stringify({ queries: [{ language: "en", query: "seed oils health evidence" }] }));
    const initial = { ...noResults, sourceTitles: ["Seed oils: health effects", "Examining claims about canola oil"] };
    const search = vi.fn().mockResolvedValue(initial);
    await retrieveProjectResearchEvidence({ passageSearch: { search }, question: "Compare these viewpoints", projectName: "Untitled", signal: new AbortController().signal, onUsage: vi.fn() });
    const prompt = JSON.parse(fetch.mock.calls[0][1].body).messages[0].content;
    expect(prompt).toContain('SOURCE_TITLES: ["Seed oils: health effects","Examining claims about canola oil"]');
    expect(search).toHaveBeenLastCalledWith({ query: "seed oils health evidence", limit: 10, balanceSources: true });
  });

  it("keeps a minority-language source represented alongside many matching passages", async () => {
    gateway(JSON.stringify({ queries: [
      { language: "en", query: "seed oil" },
      { language: "es", query: "aceite semillas" },
    ] }));
    const english = Array.from({ length: 10 }, (_, index) => passage({ segmentOrdinal: index + 1, text: `English source statement ${index + 1}.` }));
    const spanish = passage({ videoId: "20000000-0000-4000-8000-000000000002", language: "es", text: "Una perspectiva diferente sobre los aceites." });
    const initial = { ...noResults, sourceLanguages: ["en", "es"], coverage: { ...coverage, readyVideos: 2, totalVideos: 2, passagesExamined: 11 } };
    const search = vi.fn().mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ ...initial, status: "ready", passages: english })
      .mockResolvedValueOnce({ ...initial, status: "ready", passages: [spanish] });
    const result = await retrieveProjectResearchEvidence({ passageSearch: { search }, question: "比较这些来源的观点", signal: new AbortController().signal, onUsage: vi.fn() });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected ready evidence");
    expect(result.passages).toHaveLength(10);
    expect(result.passages).toContainEqual(spanish);
    expect(result.coverage.passagesExamined).toBe(11);
  });

  it("rejects a changed Source Set instead of mixing evidence revisions", async () => {
    gateway(JSON.stringify({ queries: [{ language: "en", query: "seed oils" }] }));
    const search = vi.fn().mockResolvedValueOnce(noResults).mockResolvedValueOnce({ ...noResults, sourceSetRevision: 11 });
    await expect(retrieveProjectResearchEvidence({ passageSearch: { search }, question: "种子油", signal: new AbortController().signal, onUsage: vi.fn() })).rejects.toThrow("Research retrieval");
  });

  it("records planner usage but rejects invented evidence and malformed query plans", async () => {
    gateway(JSON.stringify({ queries: [{ language: "en", query: "seed oils", evidence: "invented source text" }] }));
    const search = vi.fn().mockResolvedValue(noResults);
    const onUsage = vi.fn();
    await expect(retrieveProjectResearchEvidence({ passageSearch: { search }, question: "种子油", signal: new AbortController().signal, onUsage })).rejects.toThrow("Research retrieval");
    expect(search).toHaveBeenCalledOnce();
    expect(onUsage).toHaveBeenCalledOnce();
  });

  it("does not call a model before any videos have usable transcripts", async () => {
    const fetch = gateway("unused");
    const notReady = { ...noResults, status: "not_ready" as const, coverage: { totalVideos: 0, readyVideos: 0, passagesExamined: 0, unavailableVideos: [] } };
    const result = await retrieveProjectResearchEvidence({ passageSearch: { search: vi.fn().mockResolvedValue(notReady) }, question: "种子油", signal: new AbortController().signal, onUsage: vi.fn() });
    expect(result).toEqual(notReady);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the complete research question for planning while bounding the bootstrap lookup", async () => {
    const fetch = gateway(JSON.stringify({ queries: [{ language: "en", query: "seed oils evidence" }] }));
    const question = `${"背景问题。".repeat(60)}最后请比较种子油的证据。`;
    const search = vi.fn().mockResolvedValue(noResults);
    await retrieveProjectResearchEvidence({ passageSearch: { search }, question, signal: new AbortController().signal, onUsage: vi.fn() });
    expect(Array.from(search.mock.calls[0][0].query)).toHaveLength(200);
    expect(JSON.parse(fetch.mock.calls[0][1].body).messages[0].content).toContain(question);
  });

  it("does no retrieval or provider work for an already-cancelled question", async () => {
    const fetch = gateway("unused");
    const search = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(retrieveProjectResearchEvidence({ passageSearch: { search }, question: "种子油", signal: controller.signal, onUsage: vi.fn() })).rejects.toThrow();
    expect(search).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
