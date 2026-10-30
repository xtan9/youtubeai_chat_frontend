import { describe, expect, it } from "vitest";
import { prepareResearchCitations } from "../project-research-citations";
import type { ResearchEvidence } from "../project-research-contract";

const evidence: ResearchEvidence = {
  id: "E1234567890123456", kind: "publication_abstract", originId: "10.1/trial",
  title: "Human trial", url: "https://europepmc.org/article/MED/123",
  text: "The adjusted effect was not significant (P=0.14); no mortality benefit was established.",
  retrievedAt: "2026-10-30T00:00:00.000Z", year: "2024", authors: null,
  publicationTypes: ["Randomized Controlled Trial"],
};
const observation = {
  text: "The trial did not establish a mortality benefit.",
  references: [{ id: evidence.id, excerptIndex: 0 }],
};
const selected = {
  judgment: observation, findings: [observation], reasoning: observation,
  changes: "This establishes an initial judgment.",
  uncertainties: ["Are longer follow-up data available?"],
  nextSteps: ["Find longer randomized trials."],
};

describe("server-issued research citation selectors", () => {
  it("inserts exact canonical text without requiring model transcription", () => {
    const context = prepareResearchCitations([evidence]);
    expect(context.readSynthesis(JSON.stringify(selected)).judgment.references).toEqual([
      { id: evidence.id, quote: evidence.text },
    ]);
  });
  it.each([12, 900, 905, 1801, 8000])("retains all %i source characters and bounds every excerpt", (length) => {
    const text = ("Qualified result with unicode α and emoji 🧪. ".repeat(200)).slice(0, length);
    const context = prepareResearchCitations([{ ...evidence, text }]);
    const excerpts = context.sources[0].excerpts;
    expect(excerpts.map((item) => item.text).join("")).toBe(text);
    for (const excerpt of excerpts) {
      expect(excerpt.text.length).toBeGreaterThanOrEqual(12);
      expect(excerpt.text.length).toBeLessThanOrEqual(1200);
      const result = context.readSynthesis(JSON.stringify({
        ...selected,
        judgment: { ...observation, references: [{ id: evidence.id, excerptIndex: excerpt.index }] },
      }));
      expect(text.includes(result.judgment.references[0].quote)).toBe(true);
    }
  });
  it("rejects an invented source or excerpt rather than guessing support", () => {
    const context = prepareResearchCitations([evidence]);
    for (const [ref, reason] of [
      [{ id: "E0000000000000000", excerptIndex: 0 }, "unknown_reference"],
      [{ id: evidence.id, excerptIndex: 99 }, "unknown_excerpt"],
    ] as const) {
      expect(() => context.readSynthesis(JSON.stringify({
        ...selected, judgment: { ...observation, references: [ref] },
      }))).toThrow(reason);
    }
  });
  it("rejects model-written quotation fields and fractional selectors", () => {
    const context = prepareResearchCitations([evidence]);
    for (const reference of [
      { id: evidence.id, quote: "An altered interpretation of P=0.14" },
      { id: evidence.id, excerptIndex: 0, quote: evidence.text },
      { id: evidence.id, excerptIndex: 0.5 },
    ]) expect(() => context.readSynthesis(JSON.stringify({
      ...selected, judgment: { ...observation, references: [reference] },
    }))).toThrow();
  });
});
