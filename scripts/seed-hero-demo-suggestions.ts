/**
 * Fill `/tmp/yt-demo-data/all.json` with per-(id, lang) suggested
 * follow-up questions. Reads each `summaries[lang].summary` already in
 * the file (placed there by `seed-hero-demo-translations.ts` + the prod
 * dump) and asks the LLM gateway for a tailored 3-question follow-up.
 *
 * The prompt + JSON schema mirror `lib/services/suggested-followups.ts`
 * exactly so the data this script writes matches what the route would
 * generate at runtime — the function isn't imported because its module
 * is `server-only`-tagged (refuses to load outside the Next.js build).
 *
 * Idempotent: combos whose `summaries[lang].suggestions` is already a
 * valid 3-string array are skipped.
 *
 * Requires LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY env vars (pull them
 * from prod with `vercel env pull .env.production.local --environment=production`
 * once and source via `set -a; source .env.production.local; set +a`).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   pnpm tsx scripts/seed-hero-demo-suggestions.ts [--concurrency=4] [--only=<id>]
 *
 * --concurrency=N:  parallel LLM calls (default 4, max 8).
 * --only=<id>:      only seed combos for one specific id.
 */
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

import { HERO_DEMO_VIDEO_IDS } from "../lib/constants/hero-demo-ids";
import { SUPPORTED_OUTPUT_LANGUAGES } from "../lib/constants/languages";
import { SONNET } from "../lib/services/models";

// Mirrors lib/services/suggested-followups.ts:11-14. Single source of
// truth would be ideal, but that file is server-only — so this
// duplication is the controlled cost of running outside Next.
const SuggestedFollowupsSchema = z
  .array(z.string().min(1).max(160))
  .min(3)
  .max(3);
type SuggestedFollowups = z.infer<typeof SuggestedFollowupsSchema>;

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

async function generateSuggestedFollowups(options: {
  summary: string;
  timeoutMs: number;
}): Promise<SuggestedFollowups> {
  const gatewayUrl = process.env.LLM_GATEWAY_URL?.trim();
  const gatewayKey = process.env.LLM_GATEWAY_API_KEY?.trim();
  if (!gatewayUrl || !gatewayKey) {
    throw new Error(
      "LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY must be set (vercel env pull)",
    );
  }
  const prompt = FOLLOWUPS_PROMPT.replace("{{SUMMARY}}", options.summary);
  const response = await fetch(
    `${gatewayUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gatewayKey}`,
      },
      body: JSON.stringify({
        model: SONNET,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      }),
      signal: AbortSignal.timeout(options.timeoutMs),
    },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`LLM gateway error (${response.status}): ${text}`);
  }
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("LLM gateway response missing choices[0].message.content");
  }
  const trimmed = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const parsed = JSON.parse(trimmed);
  return SuggestedFollowupsSchema.parse(parsed);
}

const DATA_PATH = "/tmp/yt-demo-data/all.json";
const PER_CALL_TIMEOUT_MS = 30_000;
const MAX_CONCURRENCY = 8;

interface CapturedSummary {
  summary: string;
  model: string;
  suggestions?: SuggestedFollowups;
}

interface CapturedRecord {
  youtubeId: string;
  title: string;
  channel: string;
  durationSec: number | null;
  nativeLanguage: string | null;
  segments: unknown[];
  summaries: Record<string, CapturedSummary>;
}

interface Combo {
  readonly id: string;
  readonly lang: string;
}

function parseArgs(): { concurrency: number; only: string | null } {
  const args = process.argv.slice(2);
  const concArg = args.find((a) => a.startsWith("--concurrency="));
  const concurrency = concArg
    ? Math.min(MAX_CONCURRENCY, Math.max(1, Number(concArg.split("=")[1]) || 4))
    : 4;
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.split("=")[1] : null;
  return { concurrency, only };
}

function isValidSuggestionsTuple(s: unknown): s is SuggestedFollowups {
  return (
    Array.isArray(s) &&
    s.length === 3 &&
    s.every((q) => typeof q === "string" && q.length > 0)
  );
}

async function main(): Promise<void> {
  const { concurrency, only } = parseArgs();
  const raw = await readFile(DATA_PATH, "utf8");
  const data = JSON.parse(raw) as Record<string, CapturedRecord>;
  const allLangs = SUPPORTED_OUTPUT_LANGUAGES.map((l) => l.code);
  const ids = only ? [only] : HERO_DEMO_VIDEO_IDS;

  const todo: Combo[] = [];
  for (const id of ids) {
    const r = data[id];
    if (!r) {
      throw new Error(`Missing record for ${id} in ${DATA_PATH}`);
    }
    for (const lang of allLangs) {
      const s = r.summaries[lang];
      if (!s) {
        throw new Error(
          `Missing summaries.${lang} for ${id} — run seed-hero-demo-translations.ts first`,
        );
      }
      if (!isValidSuggestionsTuple(s.suggestions)) {
        todo.push({ id, lang });
      }
    }
  }

  const totalTodo = todo.length;
  console.log(
    `[suggestions] ${totalTodo} missing combos (concurrency=${concurrency}, only=${only ?? "all"})`,
  );
  if (totalTodo === 0) return;

  let processed = 0;
  let okCount = 0;
  let errorCount = 0;
  const errors: { combo: Combo; message: string }[] = [];

  async function worker() {
    while (true) {
      const c = todo.shift();
      if (!c) return;
      const summary = data[c.id].summaries[c.lang].summary;
      const start = Date.now();
      try {
        const followups = await generateSuggestedFollowups({
          summary,
          timeoutMs: PER_CALL_TIMEOUT_MS,
        });
        data[c.id].summaries[c.lang].suggestions = followups;
        okCount += 1;
      } catch (err) {
        errorCount += 1;
        errors.push({
          combo: c,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      processed += 1;
      const elapsed = `${((Date.now() - start) / 1000).toFixed(1)}s`.padStart(6);
      console.log(
        `[suggestions] ${String(processed).padStart(3)}/${totalTodo}  ${elapsed}  ${c.id} ${c.lang}`,
      );

      // Checkpoint every 20 successes — protects long runs against a
      // crash that would otherwise lose all in-memory progress.
      if (okCount > 0 && okCount % 20 === 0) {
        await writeFile(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await writeFile(DATA_PATH, JSON.stringify(data, null, 2), "utf8");

  console.log(`[suggestions] done. ok=${okCount} errors=${errorCount}`);
  if (errorCount > 0) {
    console.error("[suggestions] errors:");
    for (const e of errors) {
      console.error(`  ${e.combo.id} ${e.combo.lang}: ${e.message}`);
    }
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
