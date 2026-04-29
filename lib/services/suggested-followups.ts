import "server-only";
import { z } from "zod";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { callLlmJson } from "./llm-client";
import { SONNET, type KnownModel } from "./models";

// Wire shape persisted on summaries.suggested_followups. Validated via
// zod so a future schema-drift in either the LLM output OR a hand-edit
// of the cached row surfaces as a parse error rather than a silent
// "render two suggestions" or "render undefined" UX bug.
export const SuggestedFollowupsSchema = z
  .array(z.string().min(1).max(160))
  .min(3)
  .max(3);

export type SuggestedFollowups = z.infer<typeof SuggestedFollowupsSchema>;

const FOLLOWUPS_PROMPT = `You are designing the chat surface for a YouTube viewing app. The user has just finished reading the AI summary of a video and is opening a chat tab to dig deeper. Generate exactly three short follow-up questions that THIS specific summary would naturally invite — not generic questions that work for any video.

Constraints:
- Output ONLY a JSON array of three strings. No prose, no preamble, no trailing commentary, no markdown fences.
- Each question is 4-15 words. Avoid yes/no questions.
- Match the language of the summary.
- Reference specifics from the summary (a name, claim, term, or example) so the questions feel tailored, not boilerplate.
- Avoid duplicating the summary itself — questions should expand, contrast, or test the summary's points, not restate them.

Summary:
<summary>
{{SUMMARY}}
</summary>`;

class ServiceRoleUnavailableError extends Error {
  constructor() {
    super("[suggested-followups] service-role client unavailable");
    this.name = "ServiceRoleUnavailableError";
  }
}

/**
 * Read the cached follow-ups for the user-native summary of (video).
 * Returns null when no row exists or the column is NULL.
 *
 * Native-summary scoping (`output_language IS NULL`) matches how
 * /api/chat/stream gates chat — translated summaries reuse the native
 * follow-ups since the questions are content-derived, not language-
 * derived.
 */
export async function readSuggestedFollowups(
  videoId: string,
): Promise<SuggestedFollowups | null> {
  const supabase = getServiceRoleClient();
  if (!supabase) throw new ServiceRoleUnavailableError();

  const { data, error } = await supabase
    .from("summaries")
    .select("suggested_followups")
    .eq("video_id", videoId)
    .is("output_language", null)
    .maybeSingle();
  if (error) {
    console.error("[suggested-followups] read failed", {
      errorId: "FOLLOWUPS_READ_FAILED",
      videoId,
      code: error.code,
      message: error.message,
    });
    throw error;
  }
  const raw = (data as { suggested_followups: unknown } | null)
    ?.suggested_followups;
  if (raw == null) return null;
  const parsed = SuggestedFollowupsSchema.safeParse(raw);
  if (!parsed.success) {
    // A drifted row (manual edit, future schema change) shouldn't break
    // the empty state — log and fall back to "regenerate".
    console.error("[suggested-followups] cached row failed schema", {
      errorId: "FOLLOWUPS_SCHEMA_DRIFT",
      videoId,
      issues: parsed.error.issues,
    });
    return null;
  }
  return parsed.data;
}

/**
 * Persist follow-ups onto the user-native summary row. Idempotent —
 * the column is the cache; overwrites are fine.
 */
export async function writeSuggestedFollowups(
  videoId: string,
  followups: SuggestedFollowups,
): Promise<void> {
  const supabase = getServiceRoleClient();
  if (!supabase) throw new ServiceRoleUnavailableError();

  const { error } = await supabase
    .from("summaries")
    .update({ suggested_followups: followups })
    .eq("video_id", videoId)
    .is("output_language", null);
  if (error) {
    console.error("[suggested-followups] write failed", {
      errorId: "FOLLOWUPS_WRITE_FAILED",
      videoId,
      code: error.code,
      message: error.message,
    });
    throw error;
  }
}

interface GenerateOptions {
  readonly summary: string;
  readonly model?: KnownModel | (string & {});
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/**
 * One-shot LLM call that asks the model for three tailored follow-up
 * questions about the given summary. Returns parsed `SuggestedFollowups`
 * on success; rejects on schema fail so callers can fall back to
 * static suggestions rather than render an undefined / partial array.
 */
export async function generateSuggestedFollowups(
  options: GenerateOptions,
): Promise<SuggestedFollowups> {
  const prompt = FOLLOWUPS_PROMPT.replace("{{SUMMARY}}", options.summary);
  const raw = await callLlmJson({
    model: options.model ?? SONNET,
    prompt,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
  // The model is instructed to emit pure JSON; some models still wrap
  // in ```json fences. Strip a single fenced block before parsing
  // rather than retrying the whole call.
  const trimmed = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    console.error("[suggested-followups] LLM emitted non-JSON", {
      errorId: "FOLLOWUPS_LLM_NON_JSON",
      preview: trimmed.slice(0, 200),
      err,
    });
    throw new Error("Suggested-followups response was not JSON");
  }
  const validated = SuggestedFollowupsSchema.safeParse(parsed);
  if (!validated.success) {
    console.error("[suggested-followups] LLM output failed schema", {
      errorId: "FOLLOWUPS_LLM_SCHEMA",
      preview: trimmed.slice(0, 200),
      issues: validated.error.issues,
    });
    throw new Error("Suggested-followups response failed schema");
  }
  return validated.data;
}
