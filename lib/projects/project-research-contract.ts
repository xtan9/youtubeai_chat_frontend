import { z } from "zod";

export const ResearchReferenceSchema = z
  .object({
    id: z.string().regex(/^[VE][a-f0-9]{16}$/u),
    quote: z.string().min(12).max(1200),
  })
  .strict();
export const ResearchObservationSchema = z
  .object({
    text: z.string().trim().min(8).max(1800),
    references: z.array(ResearchReferenceSchema).min(1).max(6),
  })
  .strict();
export const ResearchSynthesisSchema = z
  .object({
    judgment: ResearchObservationSchema,
    findings: z.array(ResearchObservationSchema).min(1).max(8),
    reasoning: ResearchObservationSchema,
    changes: z.string().trim().min(8).max(1600),
    uncertainties: z.array(z.string().trim().min(5).max(600)).min(1).max(5),
    nextSteps: z.array(z.string().trim().min(5).max(600)).min(1).max(4),
  })
  .strict();
export const ResearchEvidenceSchema = z
  .object({
    id: z.string().regex(/^[VE][a-f0-9]{16}$/u),
    kind: z.enum(["video", "publication_abstract"]),
    originId: z.string().min(1).max(300),
    title: z.string().min(1).max(1000),
    url: z
      .url()
      .refine((url) =>
        /^https:\/\/(?:europepmc\.org\/article\/(?:MED|PMC)\/|www\.youtube\.com\/watch\?v=)/u.test(
          url,
        ),
      ),
    text: z.string().min(12).max(8000),
    retrievedAt: z.iso.datetime(),
    year: z.string().max(4).nullable(),
    authors: z.string().max(1000).nullable(),
    publicationTypes: z.array(z.string().max(100)).max(20),
  })
  .strict();
export type ResearchEvidence = z.infer<typeof ResearchEvidenceSchema>;
export type ResearchSynthesis = z.infer<typeof ResearchSynthesisSchema>;
export const ResearchDocumentSchema = z
  .object({
    question: z.string().trim().min(3).max(2000),
    synthesis: ResearchSynthesisSchema,
    evidence: z.array(ResearchEvidenceSchema).min(1).max(24),
    searches: z
      .array(
        z
          .object({
            query: z.string().max(500),
            purpose: z.string().max(400),
            results: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(3),
    warnings: z.array(z.string().max(400)).max(6),
    sourceSetRevision: z.number().int().nonnegative(),
    promptVersion: z.literal("project-research-v1"),
  })
  .strict();
export type ResearchDocument = z.infer<typeof ResearchDocumentSchema>;
export const ResearchVersionSchema = z
  .object({
    id: z.uuid(),
    created_at: z.string(),
    document: ResearchDocumentSchema,
  })
  .strict();
export type ResearchVersion = z.infer<typeof ResearchVersionSchema>;
export const ResearchRequestSchema = z
  .object({
    question: z.string().trim().min(3).max(2000),
    baseVersionId: z.uuid().nullable(),
  })
  .strict();

/** Accept one complete JSON object, optionally wrapped in a Markdown fence.
 * Never extract a guessed object from commentary or repair source content. */
export function parseResearchJson(raw: string): unknown {
  const text = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(text);
  return JSON.parse(fenced ? fenced[1] : text);
}

/** Refuse hallucinated references/URLs and altered quotations; semantic analysis remains AI interpretation. */
export function validateResearchSynthesis(
  raw: string,
  evidence: readonly ResearchEvidence[],
) {
  const parsed = ResearchSynthesisSchema.parse(parseResearchJson(raw));
  const byId = new Map(evidence.map((item) => [item.id, item]));
  for (const item of [parsed.judgment, ...parsed.findings, parsed.reasoning]) {
    if (/https?:\/\/|\[[VE][a-f0-9]{16}\]/iu.test(item.text))
      throw new Error("untrusted_presentation");
    for (const ref of item.references) {
      if (!byId.has(ref.id)) throw new Error("unknown_reference");
      if (!byId.get(ref.id)!.text.includes(ref.quote))
        throw new Error("altered_quotation");
    }
    // Multiple supporting excerpts from one source are legitimate. Validate
    // every excerpt first, then render one citation to the complete source.
    const seen = new Set<string>();
    item.references = item.references.filter((reference) => {
      if (seen.has(reference.id)) return false;
      seen.add(reference.id);
      return true;
    });
  }
  if (
    evidence.some((item) => item.kind === "publication_abstract") &&
    ![parsed.judgment, ...parsed.findings].some((item) =>
      item.references.some(
        (ref) => byId.get(ref.id)?.kind === "publication_abstract",
      ),
    )
  ) {
    throw new Error("missing_external_evidence");
  }
  return parsed;
}
