import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { streamChatCompletion } = vi.hoisted(() => ({ streamChatCompletion: vi.fn() }));
vi.mock("@/lib/services/llm-chat-client", () => ({ streamChatCompletion }));

import { prepareProjectBriefGeneration } from "../project-brief-generation";
import type { ProjectAnswerSourceManifest, ProjectEvidenceSnapshot } from "../project-grounded-answer-contract";

const projectId = "10000000-0000-4000-8000-000000000001";
const videos = ["20000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002"];
const excerpts = [
  "This speaker attributes inflammation to seed oils.",
  "This speaker says controlled trials did not find increased inflammation.",
];
const evidenceSnapshot: ProjectEvidenceSnapshot = {
  projectId, sourceSetRevision: 10,
  passages: excerpts.map((text, index) => ({
    passageId: `${videos[index]}:1:0:${text.length}`, videoId: videos[index],
    youtubeVideoId: index ? "bbbbbbb0002" : "aaaaaaa0001", title: `Perspective ${index + 1}`,
    channelName: null, text, segmentOrdinal: 1, excerptStartCharacter: 0,
    excerptEndCharacter: text.length, startSeconds: 12 + index * 10,
    endSeconds: 20 + index * 10, language: "en", truncatedStart: false, truncatedEnd: false,
  })),
};
const sourceManifest: ProjectAnswerSourceManifest = {
  projectId, sourceSetRevision: 10,
  sources: evidenceSnapshot.passages.map((passage, index) => ({
    sourceId: `S${index + 1}`, videoId: passage.videoId, youtubeVideoId: passage.youtubeVideoId,
    title: passage.title, channelName: null,
    passages: [{ passageId: passage.passageId, startSeconds: passage.startSeconds, endSeconds: passage.endSeconds }],
  })),
};
const evidence = (index: number) => ({ evidenceId: `E${index + 1}`, quote: excerpts[index] });
const plan = () => ({
  overview: { text: "两段材料对种子油与炎症的关系存在分歧，不能据此确定因果。", evidence: [evidence(0), evidence(1)] },
  findings: [
    { text: "第一位讲者把炎症归因于种子油。", evidence: [evidence(0)] },
    { text: "第二位讲者表示对照试验没有发现炎症增加。", evidence: [evidence(1)] },
  ],
  agreements: [],
  disagreements: [{ text: "两位讲者对炎症风险的解读不同，应核对各自援引的研究。", evidence: [evidence(0), evidence(1)] }],
  openQuestions: [{ text: "这些讲者援引的研究是否考察了相同的油类、剂量和人群？", evidence: [evidence(0), evidence(1)] }],
});

async function prepare() {
  return prepareProjectBriefGeneration({
    projectName: "种子油研究", goal: "确认种子油是否有害，不预设结论", sourceManifest, evidenceSnapshot,
    signal: new AbortController().signal, onUsage: vi.fn(),
  });
}

describe("Project Brief research generation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // The old pipeline successfully normalizes these exact clauses, then
    // rejects useful synthesized prose. The regression reaches that real seam.
    streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta", text: JSON.stringify({ records: excerpts.map((text, index) => ({
        candidateId: `C${index + 1}`, sourceId: `S${index + 1}`, citation: `[S${index + 1} @ 00:${12 + index * 10}]`,
        clause: text.slice(0, -1), interpretation: { issueKey: "inflammation", relation: index ? "opposes" : "supports", resolution: "settled" },
      })) }) };
    });
  });

  it("accepts useful multilingual synthesis with server-bound evidence instead of copying caption fragments", async () => {
    const generation = await prepare();
    const result = generation.validate(JSON.stringify(plan()));
    expect(result.status).toBe("valid");
    if (result.status !== "valid") throw new Error(result.reason);
    expect(result.content).toContain("两段材料对种子油与炎症的关系存在分歧");
    expect(result.content).toContain("[S1 @ 00:12]");
    expect(result.content).toContain("[S2 @ 00:22]");
    expect(result.content).toContain("## Material disagreements");
    expect(result.content).toContain("2 passages from 2 videos");
    expect(result.content).toContain("not an independent fact check");
    expect(generation.generationMetadata.normalizationAudit.recordSetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(streamChatCompletion).not.toHaveBeenCalled();
  });

  it("provides complete context and asks for neutral attributed synthesis", async () => {
    const generation = await prepare();
    const prompt = generation.messages[0].content;
    expect(prompt).toContain(excerpts[0]);
    expect(prompt).toContain(excerpts[1]);
    expect(prompt).toContain("not a conclusion to confirm");
    expect(prompt).toContain("Do not infer a source's position from silence");
    expect(prompt).not.toContain("Output record IDs only");
  });

  it("prepares bounded correction guidance using only known reasons and the same evidence", async () => {
    const generation = await prepare();
    const repaired = generation.repairMessages("altered_quotation");
    expect(repaired).not.toBeNull();
    expect(repaired?.slice(0, -1)).toEqual(generation.messages);
    expect(repaired?.at(-1)?.content).toContain("altered_quotation");
    expect(repaired?.at(-1)?.content).toContain("Do not translate");
    expect(generation.repairMessages("private-invalid-model-output")).toBeNull();
    expect(generation.validate(JSON.stringify(plan())).status).toBe("valid");
    expect(streamChatCompletion).not.toHaveBeenCalled();
  });

  it.each([
    ["Our findings do not show that seed oils cause inflammation in humans.", "seed oils cause inflammation in humans", "The findings show that seed oils cause inflammation in humans."],
    ["The trial found no harm, but the sample was small and follow-up lasted only six months.", "The trial found no harm", "The trial establishes that no harm occurs."],
  ])("always shows the full source context even when a model selects a misleading substring: %s", async (fullSource, selectedQuote, modelClaim) => {
    const passage = { ...evidenceSnapshot.passages[0], text: fullSource, passageId: `${videos[0]}:1:0:${fullSource.length}`, excerptEndCharacter: fullSource.length };
    const generation = await prepareProjectBriefGeneration({
      projectName: "Seed oil research", goal: "Evaluate the evidence", signal: new AbortController().signal, onUsage: vi.fn(),
      evidenceSnapshot: { ...evidenceSnapshot, passages: [passage] },
      sourceManifest: { ...sourceManifest, sources: [{ ...sourceManifest.sources[0], passages: [{ passageId: passage.passageId, startSeconds: passage.startSeconds, endSeconds: passage.endSeconds }] }] },
    });
    const observation = { text: modelClaim, evidence: [{ evidenceId: "E1", quote: selectedQuote }] };
    const result = generation.validate(JSON.stringify({
      overview: observation,
      findings: [{ text: "The source's full wording should be inspected before drawing a conclusion.", evidence: [{ evidenceId: "E1", quote: fullSource }] }],
      agreements: [], disagreements: [], openQuestions: [],
    }));
    // Referential validation does not certify model interpretation. Its
    // presentation must expose the full contrary/qualified evidence.
    expect(result.status).toBe("valid");
    if (result.status !== "valid") throw new Error(result.reason);
    expect(result.content).toContain(`> ${fullSource} [S1 @ 00:12]`);
    expect(result.content).not.toContain(`> ${selectedQuote} [S1 @ 00:12]`);
    expect(result.content.split(`> ${fullSource}`).length - 1).toBe(1);
    expect(result.content).toContain("they do not certify the analysis");
  });

  it.each(["unknown evidence", "altered quotation", "single-source comparison", "invented citation", "missing source"])("rejects %s before persistence", async (attack) => {
    const generation = await prepare();
    const output = plan();
    if (attack === "unknown evidence") output.findings[0].evidence[0].evidenceId = "E99";
    if (attack === "altered quotation") output.findings[0].evidence[0].quote = "Seed oils conclusively kill everyone.";
    if (attack === "single-source comparison") output.disagreements[0].evidence = [evidence(0)];
    if (attack === "invented citation") output.findings[0].text += " [S9 @ 00:99]";
    if (attack === "missing source") {
      output.overview.evidence = [evidence(0)];
      output.findings = [output.findings[0]];
      output.disagreements = [];
      output.openQuestions = [];
    }
    expect(generation.validate(JSON.stringify(output)).status).toBe("invalid");
  });
});
