import { z } from "zod";

export const ContinueLearningRelationshipSchema = z.enum([
  "deeper_explanation",
  "prerequisite",
  "practical_application",
  "credible_alternative",
]);

const OpaqueSetTokenSchema = z
  .string()
  .regex(/^cl1s\.[A-Za-z0-9_-]{43}$/, "Invalid Set version token");
const OpaqueRecommendationTokenSchema = z
  .string()
  .regex(/^cl1\.[A-Za-z0-9_-]{43}$/, "Invalid Recommendation token");

export const ContinueLearningReadyResponseSchema = z
  .object({
    outcome: z.literal("ready"),
    setVersionToken: OpaqueSetTokenSchema,
    items: z
      .array(
        z
          .object({
            token: OpaqueRecommendationTokenSchema,
            ordinal: z.number().int().min(1).max(50),
            canonicalUrl: z.string().url(),
            title: z.string().nullable(),
            channelName: z.string().nullable(),
            thumbnailUrl: z.string().url().nullable(),
            relationship: ContinueLearningRelationshipSchema,
            explanation: z.string().min(1).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();

/**
 * Preparation is intentionally opaque. Until an upstream worker/status
 * contract exists, the browser receives no Set, Assessment, or job identity.
 */
export const ContinueLearningPendingResponseSchema = z
  .object({ outcome: z.literal("pending") })
  .strict();

export const ContinueLearningUnavailableReasonSchema = z.enum([
  "feature_disabled",
  "rollout_off",
  "rollout_shadow",
  "pilot_cohort_unconfigured",
  "rollout_unverifiable",
  "source_not_ready",
  "no_recommendations",
]);

export const ContinueLearningUnavailableResponseSchema = z
  .object({
    outcome: z.literal("unavailable"),
    reason: ContinueLearningUnavailableReasonSchema,
  })
  .strict();

export const ContinueLearningResponseSchema = z.discriminatedUnion("outcome", [
  ContinueLearningReadyResponseSchema,
  ContinueLearningPendingResponseSchema,
  ContinueLearningUnavailableResponseSchema,
]);

export type ContinueLearningReadyResponse = z.infer<
  typeof ContinueLearningReadyResponseSchema
>;
export type ContinueLearningResponse = z.infer<
  typeof ContinueLearningResponseSchema
>;
export type ContinueLearningUnavailableReason = z.infer<
  typeof ContinueLearningUnavailableReasonSchema
>;
