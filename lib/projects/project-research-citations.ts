import { z } from "zod";
import {
  ResearchObservationSchema,
  ResearchReferenceSchema,
  ResearchSynthesisSchema,
  parseResearchJson,
  validateResearchSynthesis,
  type ResearchEvidence,
} from "./project-research-contract";

const SelectedObservationSchema = ResearchObservationSchema.extend({
  references: z.array(
    z.object({
      id: ResearchReferenceSchema.shape.id,
      excerptIndex: z.number().int().nonnegative(),
    }).strict(),
  ).min(1).max(6),
});
const SelectedSynthesisSchema = ResearchSynthesisSchema.extend({
  judgment: SelectedObservationSchema,
  findings: z.array(SelectedObservationSchema).min(1).max(8),
  reasoning: SelectedObservationSchema,
});

/** Contiguous, complete source text; the model selects, never transcribes, quotes. */
function excerpts(text: string) {
  const result: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 900, text.length);
    const boundary = text.lastIndexOf(" ", end);
    if (end < text.length && boundary > start + 600) end = boundary + 1;
    if (text.length - end < 12) end = text.length;
    // Do not divide a UTF-16 surrogate pair between excerpts.
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
    result.push(text.slice(start, end));
    start = end;
  }
  return result;
}

export function prepareResearchCitations(evidence: readonly ResearchEvidence[]) {
  const sources = evidence.map(({ text, ...metadata }) => ({
    ...metadata,
    excerpts: excerpts(text).map((text, index) => ({ index, text })),
  }));
  const byId = new Map(sources.map((source) => [source.id, source]));
  return {
    sources,
    readSynthesis(raw: string) {
      const selected = SelectedSynthesisSchema.parse(parseResearchJson(raw));
      const resolve = (observation: z.infer<typeof SelectedObservationSchema>) => ({
        text: observation.text,
        references: observation.references.map(({ id, excerptIndex }) => {
          const source = byId.get(id);
          if (!source) throw new Error("unknown_reference");
          const quote = source.excerpts[excerptIndex]?.text;
          if (!quote) throw new Error("unknown_excerpt");
          return { id, quote };
        }),
      });
      return validateResearchSynthesis(
        JSON.stringify({
          ...selected,
          judgment: resolve(selected.judgment),
          findings: selected.findings.map(resolve),
          reasoning: resolve(selected.reasoning),
        }),
        evidence,
      );
    },
  };
}
