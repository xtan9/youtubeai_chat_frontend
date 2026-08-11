import { createHash } from "node:crypto";
import {
  parseSemanticProfile,
  requestSemanticProfileWithUsage,
  SEMANTIC_PROFILE_PROMPT_VERSION,
  SEMANTIC_PROFILE_SCHEMA_VERSION,
} from "./semantic-profile";
import {
  evaluateSemanticProfileEvidence,
  SEMANTIC_PROFILE_EVALUATION_CASES,
  SEMANTIC_PROFILE_EVALUATION_TRIALS,
  type SemanticProfileEvaluationObservation,
  type SemanticProfileEvaluationPricing,
} from "./semantic-profile-evaluation";

export const SEMANTIC_PROFILE_EVALUATION_ARTIFACT_VERSION =
  "semantic-profile-evaluation-v1" as const;
export const SEMANTIC_PROFILE_EVALUATION_CORPUS_VERSION =
  "semantic-profile-structured-multilingual-v1" as const;

const EVALUATION_CONCURRENCY = 2;
const EVALUATION_TIMEOUT_MS = 35_000;

export interface RunSemanticProfileEvaluationOptions {
  readonly modelIdentifier: string;
  readonly gatewayProvider: string;
  readonly sourceRevision: string;
  readonly evaluatedAt: Date;
  readonly pricing: SemanticProfileEvaluationPricing;
}

export type SemanticProfileEvaluationArtifact = Awaited<
  ReturnType<typeof runSemanticProfileEvaluation>
>;

export async function runSemanticProfileEvaluation(
  options: RunSemanticProfileEvaluationOptions,
) {
  const modelIdentifier = requireIdentifier(
    options.modelIdentifier,
    "model identifier",
  );
  const gatewayProvider = requireIdentifier(
    options.gatewayProvider,
    "Gateway provider",
  );
  if (!/^[a-f0-9]{40,64}$/.test(options.sourceRevision)) {
    throw new Error("Semantic Profile evaluation requires a full source revision");
  }
  if (Number.isNaN(options.evaluatedAt.getTime())) {
    throw new Error("Semantic Profile evaluation requires a valid timestamp");
  }
  for (const value of Object.values(options.pricing)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("Semantic Profile evaluation pricing must be nonnegative");
    }
  }

  const requests = SEMANTIC_PROFILE_EVALUATION_CASES.flatMap((benchmarkCase) =>
    Array.from(
      { length: SEMANTIC_PROFILE_EVALUATION_TRIALS },
      (_, index) => ({ benchmarkCase, trial: index + 1 }),
    ),
  );
  const observations = await mapWithConcurrency(
    requests,
    EVALUATION_CONCURRENCY,
    async ({ benchmarkCase, trial }): Promise<SemanticProfileEvaluationObservation> => {
      const startedAt = performance.now();
      try {
        const response = await requestSemanticProfileWithUsage({
          model: modelIdentifier,
          title: benchmarkCase.text,
          sourceLanguage: benchmarkCase.language,
          transcript: benchmarkCase.text,
          signal: AbortSignal.timeout(EVALUATION_TIMEOUT_MS),
        });
        try {
          return {
            caseId: benchmarkCase.id,
            trial,
            latencyMs: elapsedMilliseconds(startedAt),
            profile: parseSemanticProfile(response.content),
            responseModel: response.responseModel,
            usage: response.usage,
          };
        } catch {
          return {
            caseId: benchmarkCase.id,
            trial,
            latencyMs: elapsedMilliseconds(startedAt),
            responseModel: response.responseModel,
            usage: response.usage,
            errorCode: "schema_validation_error",
          };
        }
      } catch {
        return {
          caseId: benchmarkCase.id,
          trial,
          latencyMs: elapsedMilliseconds(startedAt),
          errorCode: "gateway_error",
        };
      }
    },
  );
  const evaluated = evaluateSemanticProfileEvidence({
    observations,
    pricing: options.pricing,
  });
  const body = {
    artifactVersion: SEMANTIC_PROFILE_EVALUATION_ARTIFACT_VERSION,
    corpusVersion: SEMANTIC_PROFILE_EVALUATION_CORPUS_VERSION,
    profileSchemaVersion: SEMANTIC_PROFILE_SCHEMA_VERSION,
    promptVersion: SEMANTIC_PROFILE_PROMPT_VERSION,
    modelIdentifier,
    gatewayProvider,
    sourceRevision: options.sourceRevision,
    evaluatedAt: options.evaluatedAt.toISOString(),
    requestCount: evaluated.requestCount,
    metrics: evaluated.metrics,
    automatedGate: evaluated.automatedGate,
    observations,
    activation: {
      performed: false,
      evaluationLedgerRecorded: false,
      humanApprovalRecorded: false,
      humanApprovalRequired: true,
    },
  } as const;
  return {
    ...body,
    evaluationFingerprint: fingerprint(body),
  } as const;
}

export function verifySemanticProfileEvaluationFingerprint(
  artifact: SemanticProfileEvaluationArtifact,
): boolean {
  const { evaluationFingerprint, ...body } = artifact;
  return fingerprint(body) === evaluationFingerprint;
}

function requireIdentifier(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error(`Semantic Profile evaluation requires a ${label}`);
  }
  return trimmed;
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(Math.round(performance.now() - startedAt), 0);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  operation: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  const outputs = new Array<Output>(inputs.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, inputs.length) },
    async () => {
      while (nextIndex < inputs.length) {
        const index = nextIndex;
        nextIndex += 1;
        outputs[index] = await operation(inputs[index]!);
      }
    },
  );
  await Promise.all(workers);
  return outputs;
}
