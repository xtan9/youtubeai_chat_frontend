import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { retrieveProjectResearchEvidence } from "../project-research-retrieval";
import { passage } from "./project-grounded-test-fixtures";

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
