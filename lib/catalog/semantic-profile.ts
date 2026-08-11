import { z } from "zod";
import {
  callLlmJson,
  callLlmJsonWithUsage,
} from "@/lib/services/llm-client";
import { SPARK } from "@/lib/services/models";

export const SEMANTIC_PROFILE_SCHEMA_VERSION = "semantic-profile-v1" as const;
export const SEMANTIC_PROFILE_PROMPT_VERSION =
  "semantic-profile-prompt-v1" as const;
const MAX_PROFILE_RESPONSE_CHARS = 12_000;
const MAX_TRANSCRIPT_CHARS = 32_000;
const PROFILE_TIMEOUT_MS = 30_000;

const ConceptKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const ConceptSchema = z
  .object({
    key: ConceptKeySchema,
    label: z.string().trim().min(1).max(80),
  })
  .strict();

function uniqueArray<T>(key: (item: T) => string) {
  return (items: T[], context: z.core.$RefinementCtx<T[]>): void => {
    const seen = new Set<string>();
    for (const item of items) {
      const value = key(item);
      if (seen.has(value)) {
        context.addIssue({
          code: "custom",
          message: `duplicate governed value: ${value}`,
        });
      }
      seen.add(value);
    }
  };
}

const ConceptArraySchema = z
  .array(ConceptSchema)
  .min(1)
  .max(16)
  .superRefine(uniqueArray((item) => item.key));

const ConceptKeyArraySchema = z
  .array(ConceptKeySchema)
  .max(12)
  .superRefine(uniqueArray((item) => item));

export const SemanticProfileSchema = z
  .object({
    schemaVersion: z.literal(SEMANTIC_PROFILE_SCHEMA_VERSION),
    sourceLanguage: z
      .string()
      .min(2)
      .max(35)
      .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
    topics: ConceptArraySchema.max(8),
    coreConcepts: ConceptArraySchema.min(2),
    difficulty: z.enum(["beginner", "intermediate", "advanced", "mixed"]),
    prerequisiteConceptKeys: ConceptKeyArraySchema,
    applicationConceptKeys: ConceptKeyArraySchema,
    counterpointConceptKeys: ConceptKeyArraySchema,
  })
  .strict();

export type SemanticProfile = z.infer<typeof SemanticProfileSchema>;

function sortConcepts(items: SemanticProfile["topics"]) {
  return [...items].sort((left, right) => left.key.localeCompare(right.key));
}

function sortKeys(items: readonly string[]) {
  return [...items].sort((left, right) => left.localeCompare(right));
}

export function parseSemanticProfile(raw: string): SemanticProfile {
  if (raw.length > MAX_PROFILE_RESPONSE_CHARS) {
    throw new Error("Semantic Profile response exceeds the governed size limit");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw.trim());
  } catch (error) {
    throw new Error("Semantic Profile response is not valid JSON", {
      cause: error,
    });
  }

  const parsed = SemanticProfileSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error("Semantic Profile response failed schema validation", {
      cause: parsed.error,
    });
  }

  return {
    ...parsed.data,
    topics: sortConcepts(parsed.data.topics),
    coreConcepts: sortConcepts(parsed.data.coreConcepts),
    prerequisiteConceptKeys: sortKeys(parsed.data.prerequisiteConceptKeys),
    applicationConceptKeys: sortKeys(parsed.data.applicationConceptKeys),
    counterpointConceptKeys: sortKeys(parsed.data.counterpointConceptKeys),
  };
}

export interface GenerateSemanticProfileOptions {
  readonly title: string;
  readonly sourceLanguage: string;
  readonly transcript: string;
  readonly signal: AbortSignal;
}

function buildSemanticProfilePrompt(
  options: GenerateSemanticProfileOptions,
): string {
  const evidence = {
    title: options.title.trim().slice(0, 300),
    sourceLanguage: options.sourceLanguage.trim().slice(0, 35),
    transcript: options.transcript.trim().slice(0, MAX_TRANSCRIPT_CHARS),
  };

  return [
    "Create one language-independent Semantic Profile from the approved Video evidence below.",
    "Return exactly one JSON object. Do not use Markdown, commentary, confidence, scores, IDs, or fields not listed.",
    "All concept keys must be concise lowercase English ASCII kebab-case so equivalent concepts can match across source languages.",
    "Do not add facts that are not supported by the evidence.",
    "Required schema:",
    JSON.stringify({
      schemaVersion: SEMANTIC_PROFILE_SCHEMA_VERSION,
      sourceLanguage: "BCP-47 language tag from the evidence",
      topics: [{ key: "canonical-topic", label: "short learner-readable label" }],
      coreConcepts: [
        { key: "canonical-concept", label: "short learner-readable label" },
        { key: "second-concept", label: "short learner-readable label" },
      ],
      difficulty: "beginner | intermediate | advanced | mixed",
      prerequisiteConceptKeys: ["canonical-prerequisite"],
      applicationConceptKeys: ["canonical-application"],
      counterpointConceptKeys: ["canonical-alternative-perspective"],
    }),
    "Approved Video evidence:",
    JSON.stringify(evidence),
  ].join("\n");
}

export async function generateSemanticProfile(
  options: GenerateSemanticProfileOptions,
): Promise<SemanticProfile> {
  const raw = await callLlmJson({
    model: process.env.LLM_MODEL?.trim() || SPARK,
    prompt: buildSemanticProfilePrompt(options),
    timeoutMs: PROFILE_TIMEOUT_MS,
    signal: options.signal,
  });

  return parseSemanticProfile(raw);
}

export async function requestSemanticProfileWithUsage(
  options: GenerateSemanticProfileOptions & Readonly<{ model: string }>,
) {
  return callLlmJsonWithUsage({
    model: options.model,
    prompt: buildSemanticProfilePrompt(options),
    timeoutMs: PROFILE_TIMEOUT_MS,
    signal: options.signal,
  });
}
