import { describe, expect, it } from "vitest";
import {
  validateResearchSynthesis,
  type ResearchEvidence,
} from "../project-research-contract";
const evidence: ResearchEvidence[] = [
  {
    id: "E1234567890123456",
    kind: "publication_abstract",
    originId: "MED:1",
    title: "Trial",
    url: "https://europepmc.org/article/MED/1",
    text: "The randomized trial did not establish long term effects.",
    retrievedAt: "2026-10-29T00:00:00.000Z",
    year: "2026",
    authors: null,
    publicationTypes: ["Randomized Controlled Trial"],
  },
];
const observation = {
  text: "The trial leaves long-term effects unresolved.",
  references: [{ id: evidence[0].id, quote: evidence[0].text }],
};
const plan = () => ({
  judgment: observation,
  findings: [observation],
  reasoning: observation,
  changes: "This is the first research judgment.",
  uncertainties: ["What happens after longer exposure?"],
  nextSteps: ["Find longer human trials."],
});
describe("research publication boundary", () => {
  it("accepts analysis grounded in retrieved immutable abstracts", () =>
    expect(validateResearchSynthesis(JSON.stringify(plan()), evidence)).toEqual(
      plan(),
    ));
  it("rejects a fabricated publication", () => {
    const p = plan();
    p.judgment = {
      ...observation,
      references: [{ id: "E0000000000000000", quote: evidence[0].text }],
    };
    expect(() =>
      validateResearchSynthesis(JSON.stringify(p), evidence),
    ).toThrow("unknown_reference");
  });
  it("rejects translated or repaired quotations", () => {
    const p = plan();
    p.judgment = {
      ...observation,
      references: [
        {
          id: evidence[0].id,
          quote: "The randomized trial established long term effects.",
        },
      ],
    };
    expect(() =>
      validateResearchSynthesis(JSON.stringify(p), evidence),
    ).toThrow("altered_quotation");
  });
});
