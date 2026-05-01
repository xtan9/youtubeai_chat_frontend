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
 * Requires LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY env vars. Easiest:
 *   vercel env pull .env.production.local --environment=production
 * The script auto-loads `.env.production.local` from the package root
 * via Node's built-in `process.loadEnvFile`, which (unlike a shell
 * `source`) interprets `\n` escapes inside double-quoted values, so the
 * trailing-newline that Vercel writes into URL values is parsed cleanly.
 *
 * Usage:
 *   pnpm tsx scripts/seed-hero-demo-suggestions.ts [--concurrency=4] [--only=<id>]
 *
 * --concurrency=N:  parallel LLM calls (default 4, max 8).
 * --only=<id>:      only seed combos for one specific id.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

import { HERO_DEMO_VIDEO_IDS } from "../lib/constants/hero-demo-ids";
import { SUPPORTED_OUTPUT_LANGUAGES } from "../lib/constants/languages";
import { SONNET } from "../lib/services/models";
import {
  SuggestedFollowupsSchema,
  type SuggestedFollowups,
} from "../lib/services/suggested-followups-schema";

// Auto-load env from .env.production.local if present and the gateway
// vars aren't already set. Mirrors how Next.js loads env files in
// production but for one-off Node scripts.
if (
  (!process.env.LLM_GATEWAY_URL || !process.env.LLM_GATEWAY_API_KEY) &&
  existsSync(".env.production.local")
) {
  process.loadEnvFile(".env.production.local");
}

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

function extractFirstJsonArray(text: string): string | null {
  // Walk char-by-char tracking `[`/`]` depth while respecting strings —
  // returns the substring covering the first top-level array, or null
  // if no balanced array is found.
  const start = text.indexOf("[");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

async function generateSuggestedFollowups(options: {
  summary: string;
  timeoutMs: number;
  temperature?: number;
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
        temperature: options.temperature ?? 0,
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
  if (process.env.SEED_DEBUG) {
    console.error(`[debug] raw response: ${trimmed.slice(0, 400)}`);
  }
  // The LLM occasionally emits multiple JSON arrays back-to-back, an
  // object-per-question shape, or a bare-bracketed list with unescaped
  // inner quotes around foreign-language text. Each fallback below
  // corresponds to a malformation we hit while seeding the 6×17 demo
  // data set — kept resilient so future re-seeds after model changes
  // don't immediately break.
  // 1. Extract the first balanced top-level array.
  const firstArrayMatch = extractFirstJsonArray(trimmed) ?? trimmed;
  // Special-case: the model sometimes emits an object with three
  // Try the well-formed path first. The duplicate-key + question-regex
  // fallbacks below only kick in if JSON.parse fails or returns a shape
  // that isn't a usable 3-string array. Running them eagerly would let
  // a valid array containing a string like `"question": "..."` get
  // re-shaped by the regex when it shouldn't be — JSON.parse first
  // means we only re-parse on actual failure.
  let parsed: unknown;
  let parseErr: unknown = null;
  try {
    parsed = JSON.parse(firstArrayMatch);
  } catch (err) {
    parseErr = err;
  }

  const isValidStringArray = (v: unknown): v is string[] =>
    Array.isArray(v) && v.length >= 3 && v.every((e) => typeof e === "string");

  if (!isValidStringArray(parsed)) {
    // Fallback 1: the LLM sometimes emits an object with three
    // duplicate `"question": "..."` keys (or `"q":`/`"text":`).
    // JSON.parse collapses duplicates, so we lose two of the three —
    // pull each occurrence directly out of the raw text.
    const duplicateKeyMatches = Array.from(
      firstArrayMatch.matchAll(
        /"(?:question|q|text)"\s*:\s*"((?:[^"\\]|\\.)*)"/g,
      ),
    ).map((m) => m[1]);
    if (duplicateKeyMatches.length >= 3) {
      parsed = duplicateKeyMatches.slice(0, 3);
    } else if (parseErr !== null) {
      // Fallback 2: the LLM sometimes leaves unescaped ASCII quotes
      // inside foreign-language strings (e.g. CJK quoting), so
      // JSON.parse fails on the whole array. Extract anything quoted
      // that ends in a recognized question/exclamation/period
      // terminator. Logged so an operator can spot when this branch
      // fired against an unexpected input.
      const questionStrings = Array.from(
        firstArrayMatch.matchAll(/"([^"]+?[?？!！。\.])"/g),
      ).map((m) => m[1]);
      if (questionStrings.length >= 3) {
        console.warn(
          "[suggestions] regex-extracted questions after JSON.parse failure",
          { preview: firstArrayMatch.slice(0, 200) },
        );
        parsed = questionStrings.slice(0, 3);
      } else {
        throw parseErr;
      }
    }
    // If the parse succeeded but the shape is wrong (e.g. nested array
    // or array-of-objects), fall through to the normalization steps
    // below — they handle those cases.
  }
  // Cope with two common LLM malformations:
  // - `[["q1","q2","q3"]]` — single-level nesting; unwrap.
  // - `[{"question":"q1"},...]` — object-per-question; pull the string field.
  let normalized: unknown = parsed;
  if (
    Array.isArray(normalized) &&
    normalized.length === 1 &&
    Array.isArray(normalized[0])
  ) {
    normalized = normalized[0];
  }
  if (
    Array.isArray(normalized) &&
    normalized.every(
      (e) => typeof e === "object" && e !== null && !Array.isArray(e),
    )
  ) {
    const objs = normalized as Array<Record<string, unknown>>;
    // Pick the first string-typed value from each object — works for
    // {question: "..."}, {q: "..."}, {text: "..."}, etc.
    normalized = objs.map((o) => {
      const v = Object.values(o).find((x) => typeof x === "string");
      return typeof v === "string" ? v : null;
    });
  }
  return SuggestedFollowupsSchema.parse(normalized);
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
        let followups: SuggestedFollowups;
        try {
          followups = await generateSuggestedFollowups({
            summary,
            timeoutMs: PER_CALL_TIMEOUT_MS,
          });
        } catch (firstErr) {
          // One retry with a non-zero temperature — temp=0 occasionally
          // produces a malformed shape that's consistently malformed
          // across retries for the same combo. A small jitter is enough
          // to nudge the model into the schema-conformant response.
          console.log(
            `[suggestions]   ${c.id} ${c.lang} retry with temp=0.4 after: ${
              firstErr instanceof Error ? firstErr.message : String(firstErr)
            }`,
          );
          followups = await generateSuggestedFollowups({
            summary,
            timeoutMs: PER_CALL_TIMEOUT_MS,
            temperature: 0.4,
          });
        }
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
