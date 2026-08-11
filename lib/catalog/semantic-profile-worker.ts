import { z } from "zod";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { generateSemanticProfile } from "./semantic-profile";

const ClaimedWorkSchema = z
  .object({
    msg_id: z.number().int().positive(),
    read_count: z.number().int().positive(),
    request_id: z.string().uuid(),
    video_id: z.string().uuid(),
    title: z.string().min(1).max(300),
    source_language: z.string().min(2).max(35),
    transcript: z.string().min(1),
    content_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    profile_schema_version: z.literal("semantic-profile-v1"),
  })
  .strict();

type WorkerResult = Readonly<{
  claimed: number;
  completed: number;
  deferred: number;
  obsolete: number;
  retried: number;
  exhausted: number;
}>;

const BATCH_SIZE = 4;
const VISIBILITY_TIMEOUT_SECONDS = 120;
const MAX_ATTEMPTS = 4;
const BASE_RETRY_DELAY_SECONDS = 30;
const BUDGET_RETRY_DELAY_SECONDS = 900;
const ESTIMATED_MICRO_USD_PER_PROFILE = 5_000;
const GENERATION_TIMEOUT_MS = 35_000;

export async function runSemanticProfileWorker(): Promise<WorkerResult> {
  const supabase = getServiceRoleClient();
  if (!supabase) throw new Error("Semantic Profile worker is not configured");

  const claim = await supabase.rpc("claim_semantic_profile_work", {
    p_batch_size: BATCH_SIZE,
    p_visibility_timeout_seconds: VISIBILITY_TIMEOUT_SECONDS,
  });
  if (claim.error) {
    throw new Error("Semantic Profile claim failed", { cause: claim.error });
  }

  const rawWork = Array.isArray(claim.data) ? claim.data : [];
  let completed = 0;
  let deferred = 0;
  let obsolete = 0;
  let retried = 0;
  let exhausted = 0;

  const fail = async (
    raw: Record<string, unknown>,
    failureCode: "invalid_message" | "gateway_or_schema" | "worker_error",
  ): Promise<void> => {
    const requestId =
      typeof raw.request_id === "string" &&
      z.string().uuid().safeParse(raw.request_id).success
        ? raw.request_id
        : null;
    const failure = await supabase.rpc("fail_semantic_profile_work", {
      p_msg_id: raw.msg_id,
      p_request_id: requestId,
      p_failure_code: failureCode,
      p_max_attempts: MAX_ATTEMPTS,
      p_base_delay_seconds: BASE_RETRY_DELAY_SECONDS,
    });
    if (failure.error) {
      throw new Error("Semantic Profile retry failed", { cause: failure.error });
    }
    if (
      failure.data &&
      typeof failure.data === "object" &&
      "outcome" in failure.data &&
      failure.data.outcome === "exhausted"
    ) {
      exhausted += 1;
    } else {
      retried += 1;
    }
  };

  for (const candidate of rawWork) {
    const raw = candidate as Record<string, unknown>;
    const parsed = ClaimedWorkSchema.safeParse(candidate);
    if (!parsed.success) {
      await fail(raw, "invalid_message");
      continue;
    }

    const work = parsed.data;
    const budget = await supabase.rpc("begin_semantic_profile_generation", {
      p_request_id: work.request_id,
      p_estimated_micro_usd: ESTIMATED_MICRO_USD_PER_PROFILE,
    });
    if (budget.error) {
      await fail(raw, "worker_error");
      continue;
    }
    if (
      budget.data &&
      typeof budget.data === "object" &&
      "outcome" in budget.data &&
      budget.data.outcome === "budget_exhausted"
    ) {
      const release = await supabase.rpc("defer_semantic_profile_work", {
        p_msg_id: work.msg_id,
        p_request_id: work.request_id,
        p_delay_seconds: BUDGET_RETRY_DELAY_SECONDS,
      });
      if (release.error) {
        throw new Error("Semantic Profile budget deferral failed", {
          cause: release.error,
        });
      }
      deferred += 1;
      continue;
    }
    const budgetOutcome =
      budget.data &&
      typeof budget.data === "object" &&
      "outcome" in budget.data
        ? budget.data.outcome
        : null;
    if (budgetOutcome !== "started") {
      if (
        budgetOutcome !== "obsolete" &&
        budgetOutcome !== "completed" &&
        budgetOutcome !== "processing" &&
        budgetOutcome !== "exhausted"
      ) {
        await fail(raw, "worker_error");
        continue;
      }
      const acknowledgement = await supabase.rpc("ack_semantic_profile_work", {
        p_msg_id: work.msg_id,
        p_request_id: work.request_id,
      });
      if (acknowledgement.error) {
        throw new Error("Semantic Profile obsolete acknowledgement failed", {
          cause: acknowledgement.error,
        });
      }
      obsolete += 1;
      continue;
    }

    try {
      const profile = await generateSemanticProfile({
        title: work.title,
        sourceLanguage: work.source_language,
        transcript: work.transcript,
        signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
      });
      if (profile.sourceLanguage !== work.source_language) {
        throw new Error("Semantic Profile source language does not match approved evidence");
      }
      const completion = await supabase.rpc("complete_semantic_profile_work", {
        p_msg_id: work.msg_id,
        p_request_id: work.request_id,
        p_content_fingerprint: work.content_fingerprint,
        p_profile: profile,
        p_topic_keys: profile.topics.map((item) => item.key),
        p_core_concept_keys: profile.coreConcepts.map((item) => item.key),
        p_prerequisite_concept_keys: profile.prerequisiteConceptKeys,
        p_application_concept_keys: profile.applicationConceptKeys,
        p_counterpoint_concept_keys: profile.counterpointConceptKeys,
        p_difficulty: profile.difficulty,
        p_generator_model:
          process.env.LLM_MODEL?.trim() ||
          "gpt-5.3-codex-spark",
        p_prompt_version: "semantic-profile-prompt-v1",
      });
      if (completion.error) {
        await fail(raw, "worker_error");
        continue;
      }
      const completionOutcome =
        completion.data &&
        typeof completion.data === "object" &&
        "outcome" in completion.data
          ? completion.data.outcome
          : null;
      if (
        completionOutcome === "completed" ||
        completionOutcome === "already_completed"
      ) {
        completed += 1;
      } else if (completionOutcome === "obsolete") {
        obsolete += 1;
      } else {
        await fail(raw, "worker_error");
      }
    } catch {
      await fail(raw, "gateway_or_schema");
    }
  }

  return {
    claimed: rawWork.length,
    completed,
    deferred,
    obsolete,
    retried,
    exhausted,
  };
}
