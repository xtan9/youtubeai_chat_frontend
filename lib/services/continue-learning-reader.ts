import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const RelationshipSchema = z.enum([
  "deeper_explanation",
  "prerequisite",
  "practical_application",
  "credible_alternative",
]);

const ReaderItemSchema = z.object({
  setId: z.string().uuid(),
  ordinal: z.number().int().min(1).max(50),
  candidateVideoId: z.string().uuid(),
  canonicalUrl: z.string().url(),
  title: z.string().nullable(),
  channelName: z.string().nullable(),
  thumbnailUrl: z.string().url().nullable(),
  relationship: RelationshipSchema,
  explanation: z.string().min(1).max(500),
});

const ReaderPayloadSchema = z.union([
  z.object({
    outcome: z.literal("ready"),
    effectiveState: z.literal("on"),
    items: z.array(ReaderItemSchema).max(50),
  }),
  z.object({
    outcome: z.literal("unavailable"),
    reason: z.enum([
      "feature_disabled",
      "rollout_off",
      "rollout_shadow",
      "pilot_cohort_unconfigured",
      "rollout_unverifiable",
      "source_not_ready",
      "no_recommendations",
    ]),
    effectiveState: z.enum(["off", "shadow", "pilot", "on"]).optional(),
  }),
]);

export type ContinueLearningReaderItem = z.infer<typeof ReaderItemSchema>;
export type ContinueLearningReaderResult = z.infer<
  typeof ReaderPayloadSchema
>;

// The generated database type is intentionally not checked in for this
// private migration seam. Keep the adapter boundary explicit until it is
// regenerated from the deployed schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReaderClient = SupabaseClient<any, any, any>;

export async function readContinueLearningRecommendations(
  client: ReaderClient,
  input: Readonly<{
    learnerId: string;
    sourceYoutubeVideoId: string;
    limit?: number;
  }>,
): Promise<ContinueLearningReaderResult | null> {
  let result: { data: unknown; error: { code?: string; message?: string } | null };
  try {
    result = await client.rpc("read_continue_learning_recommendations", {
      p_learner_id: input.learnerId,
      p_source_youtube_video_id: input.sourceYoutubeVideoId,
      p_limit: input.limit ?? 6,
    });
  } catch (error) {
    console.error("[continue-learning] reader RPC rejected", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
  if (result.error) {
    console.error("[continue-learning] reader RPC failed", {
      code: result.error.code,
      message: result.error.message,
    });
    return null;
  }

  const parsed = ReaderPayloadSchema.safeParse(result.data);
  if (!parsed.success) {
    console.error("[continue-learning] reader RPC returned invalid payload");
    return null;
  }
  return parsed.data;
}

export async function recordContinueLearningReadyReads(
  client: ReaderClient,
  items: readonly Pick<ContinueLearningReaderItem, "setId" | "ordinal">[],
): Promise<void> {
  const results = await Promise.allSettled(
    items.map((item) =>
      client.rpc("record_recommendation_ready_read", {
        p_recommendation_set_id: item.setId,
        p_recommendation_ordinal: item.ordinal,
      }),
    ),
  );
  for (const result of results) {
    if (result.status === "rejected" || result.value.error) {
      console.error("[continue-learning] ready-read recording failed");
    }
  }
}

export { ReaderPayloadSchema };
