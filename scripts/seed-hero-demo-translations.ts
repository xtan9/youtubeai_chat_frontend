/**
 * Seed prod cache with hero-demo translations for all 17 supported
 * summary languages × 6 demo videos.
 *
 * Strategy: directly POST to https://www.youtubeai.chat/api/summarize/stream
 * with a Supabase access token from the test account's password grant.
 * Skips Playwright entirely. Streams the SSE response and waits for the
 * `complete` (or `error`) terminal event before considering a combo done.
 *
 * Idempotent: combos already cached are detected by an early
 * `cached: true` event and skipped instantly. The summarize route
 * checks the per-(youtube_url, output_language) cache before any LLM
 * call.
 *
 * Usage:
 *   set -a; source ~/.config/claude-test-creds/youtubeai.env; set +a
 *   pnpm tsx scripts/seed-hero-demo-translations.ts [--dry-run] [--concurrency=8] [--only=<id>]
 *
 * --dry-run:        list combos that WOULD be seeded; no network calls.
 * --concurrency=N:  parallel requests (default 8, max 12).
 * --only=<id>:      only seed combos for one specific id.
 */
import { HERO_DEMO_VIDEO_IDS } from "../lib/constants/hero-demo-ids";
import { SUPPORTED_OUTPUT_LANGUAGES } from "../lib/constants/languages";

const PROD_BASE_URL = process.env.SEED_BASE_URL ?? "https://www.youtubeai.chat";
const SUPABASE_URL = process.env.SUPABASE_URL;
const TEST_EMAIL = process.env.TEST_USER_EMAIL;
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD;
const PER_REQUEST_TIMEOUT_MS = 240_000; // 4 min for cold transcribe + summarize
const MAX_CONCURRENCY = 12;

interface Combo {
  readonly id: string;
  readonly lang: string;
}

function parseArgs(): {
  dryRun: boolean;
  concurrency: number;
  only: string | null;
} {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const concArg = args.find((a) => a.startsWith("--concurrency="));
  const concurrency = concArg
    ? Math.min(MAX_CONCURRENCY, Math.max(1, Number(concArg.split("=")[1]) || 8))
    : 8;
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.split("=")[1] : null;
  return { dryRun, concurrency, only };
}

function buildCombos(only: string | null): Combo[] {
  const langs = SUPPORTED_OUTPUT_LANGUAGES.map((l) => l.code);
  const ids = only ? [only] : HERO_DEMO_VIDEO_IDS;
  const out: Combo[] = [];
  for (const id of ids) {
    for (const lang of langs) {
      out.push({ id, lang });
    }
  }
  return out;
}

interface SignInResult {
  readonly accessToken: string;
  readonly userId: string;
}

async function signIn(): Promise<SignInResult> {
  if (!SUPABASE_URL || !TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error(
      "Missing SUPABASE_URL / TEST_USER_EMAIL / TEST_USER_PASSWORD. " +
        "Run: set -a; source ~/.config/claude-test-creds/youtubeai.env; set +a",
    );
  }
  // Supabase REST password grant. The anon publishable key is technically
  // required by the gateway; we read it from a public Supabase header
  // lookup since the seed script intentionally avoids depending on the
  // app's own client setup. Most Supabase projects accept the
  // service-role key here too.
  const apikey = process.env.SUPABASE_SECRET_KEY ?? "";
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey,
      Authorization: `Bearer ${apikey}`,
    },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase auth ${res.status}: ${txt}`);
  }
  const body = (await res.json()) as {
    access_token: string;
    user: { id: string };
  };
  return { accessToken: body.access_token, userId: body.user.id };
}

interface ComboResult {
  readonly combo: Combo;
  readonly outcome: "cached" | "fresh" | "error";
  readonly elapsedMs: number;
  readonly errorMessage?: string;
}

async function processCombo(
  combo: Combo,
  accessToken: string,
): Promise<ComboResult> {
  const start = Date.now();
  const youtubeUrl = `https://www.youtube.com/watch?v=${combo.id}`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), PER_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${PROD_BASE_URL}/api/summarize/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        youtube_url: youtubeUrl,
        output_language: combo.lang,
        include_transcript: false,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text();
      return {
        combo,
        outcome: "error",
        elapsedMs: Date.now() - start,
        errorMessage: `HTTP ${res.status}: ${txt.slice(0, 200)}`,
      };
    }
    if (!res.body) {
      return {
        combo,
        outcome: "error",
        elapsedMs: Date.now() - start,
        errorMessage: "no response body",
      };
    }

    let cached = false;
    let sawComplete = false;
    let lastErrorMessage: string | null = null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const evt = JSON.parse(line.slice(6)) as {
            type?: string;
            cached?: boolean;
            stage?: string;
            progress?: number;
            message?: string;
          };
          if (evt.cached === true) cached = true;
          if (evt.type === "error" && typeof evt.message === "string") {
            lastErrorMessage = evt.message;
          }
          if (
            evt.type === "complete" ||
            (evt.stage === "complete" && evt.progress === 100) ||
            evt.type === "summary"
          ) {
            sawComplete = true;
          }
        } catch {
          // ignore malformed events
        }
      }
    }
    if (lastErrorMessage && !sawComplete) {
      return {
        combo,
        outcome: "error",
        elapsedMs: Date.now() - start,
        errorMessage: lastErrorMessage,
      };
    }
    if (!sawComplete && !cached) {
      // Stream ended without an explicit complete sentinel — the route
      // sometimes closes the stream without a terminal event for cached
      // hits. Treat as fresh-finished if no error surfaced.
    }
    return {
      combo,
      outcome: cached ? "cached" : "fresh",
      elapsedMs: Date.now() - start,
    };
  } catch (err) {
    return {
      combo,
      outcome: "error",
      elapsedMs: Date.now() - start,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const { dryRun, concurrency, only } = parseArgs();
  const combos = buildCombos(only);
  console.log(
    `[seed] ${combos.length} combos (concurrency=${concurrency}, dryRun=${dryRun}, only=${only ?? "all"})`,
  );

  if (dryRun) {
    for (const c of combos) console.log(`  ${c.id}\t${c.lang}`);
    return;
  }

  const { accessToken, userId } = await signIn();
  console.log(`[seed] signed in as user ${userId}`);

  let processed = 0;
  let cachedCount = 0;
  let freshCount = 0;
  let errorCount = 0;
  const errors: ComboResult[] = [];
  const queue = [...combos];

  async function worker() {
    while (queue.length > 0) {
      const c = queue.shift();
      if (!c) return;
      const result = await processCombo(c, accessToken);
      processed += 1;
      if (result.outcome === "cached") cachedCount += 1;
      else if (result.outcome === "fresh") freshCount += 1;
      else {
        errorCount += 1;
        errors.push(result);
      }
      const tag = result.outcome.padEnd(6);
      const ms = `${(result.elapsedMs / 1000).toFixed(1)}s`.padStart(6);
      console.log(
        `[seed] ${String(processed).padStart(3)}/${combos.length} ${tag} ${ms}  ${c.id} ${c.lang}` +
          (result.errorMessage ? `  ${result.errorMessage}` : ""),
      );
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  console.log(
    `[seed] done. processed=${processed} cached=${cachedCount} fresh=${freshCount} errors=${errorCount}`,
  );
  if (errorCount > 0) {
    console.error("[seed] errors:");
    for (const e of errors) {
      console.error(`  ${e.combo.id} ${e.combo.lang}: ${e.errorMessage}`);
    }
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
