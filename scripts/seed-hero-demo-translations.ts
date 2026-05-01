/**
 * Seed prod cache with hero-demo translations for all 18 supported
 * summary languages × 6 demo videos = 108 (id, lang) combos.
 *
 * Strategy: Playwright signs into prod once via the /auth/login form,
 * then issues `context.request.post('/api/summarize/stream', ...)` for
 * each combo. The Supabase SSR cookie set during sign-in rides on every
 * subsequent request in the same context — that's what auth gives us
 * (the route's middleware reads the cookie, not the Authorization
 * header). Streams the SSE response and waits for the terminal event
 * before moving on.
 *
 * Idempotent — combos already cached resolve in <1s and emit an early
 * `cached: true` event.
 *
 * Usage:
 *   set -a; source ~/.config/claude-test-creds/youtubeai.env; set +a
 *   pnpm tsx scripts/seed-hero-demo-translations.ts [--dry-run] [--concurrency=4] [--only=<id>]
 *
 * --dry-run:        list combos that WOULD be seeded; no network calls.
 * --concurrency=N:  parallel requests (default 4, max 8).
 * --only=<id>:      only seed combos for one specific id.
 */
import { chromium } from "@playwright/test";
import type { APIRequestContext, BrowserContext } from "@playwright/test";

import { HERO_DEMO_VIDEO_IDS } from "../lib/constants/hero-demo-ids";
import { SUPPORTED_OUTPUT_LANGUAGES } from "../lib/constants/languages";

const PROD_BASE_URL = process.env.SEED_BASE_URL ?? "https://www.youtubeai.chat";
const TEST_EMAIL = process.env.TEST_USER_EMAIL;
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD;
// Match the summarize route's `maxDuration = 300` so a worst-case
// fresh combo (full transcribe + LLM call) doesn't time out client-side
// while the server is still completing. A shorter client timeout would
// log an error against a combo that was actually about to land.
const PER_REQUEST_TIMEOUT_MS = 300_000;
const MAX_CONCURRENCY = 8;

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
    ? Math.min(MAX_CONCURRENCY, Math.max(1, Number(concArg.split("=")[1]) || 4))
    : 4;
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

async function signIn(context: BrowserContext): Promise<void> {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error(
      "Missing TEST_USER_EMAIL / TEST_USER_PASSWORD. Run: " +
        "set -a; source ~/.config/claude-test-creds/youtubeai.env; set +a",
    );
  }
  const page = await context.newPage();
  try {
    await page.goto(`${PROD_BASE_URL}/auth/login`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    // Wait for the auth cookie to land. The SSR cookie name is
    // `sb-<project-ref>-auth-token` (possibly chunked into `-0`, `-1`).
    // Polling cookies is more reliable than waitForURL on the prod
    // signin -> middleware redirect chain.
    const deadline = Date.now() + 30_000;
    let signedIn = false;
    while (Date.now() < deadline) {
      const cookies = await context.cookies(PROD_BASE_URL);
      if (cookies.some((c) => c.name.includes("auth-token"))) {
        signedIn = true;
        break;
      }
      await page.waitForTimeout(500);
    }
    if (!signedIn) {
      const errorText = await page.locator(".text-accent-danger").first().textContent().catch(() => null);
      throw new Error(
        `Sign-in did not produce an auth cookie within 30s. ` +
          `Form error: ${errorText ?? "(none visible)"}`,
      );
    }
  } finally {
    await page.close();
  }
}

interface ComboResult {
  readonly combo: Combo;
  readonly outcome: "cached" | "fresh" | "error";
  readonly elapsedMs: number;
  readonly errorMessage?: string;
}

async function processCombo(
  combo: Combo,
  request: APIRequestContext,
): Promise<ComboResult> {
  const start = Date.now();
  const youtubeUrl = `https://www.youtube.com/watch?v=${combo.id}`;
  try {
    const res = await request.post(`${PROD_BASE_URL}/api/summarize/stream`, {
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      data: {
        youtube_url: youtubeUrl,
        output_language: combo.lang,
        include_transcript: false,
      },
      timeout: PER_REQUEST_TIMEOUT_MS,
    });
    if (!res.ok()) {
      const txt = await res.text();
      return {
        combo,
        outcome: "error",
        elapsedMs: Date.now() - start,
        errorMessage: `HTTP ${res.status()}: ${txt.slice(0, 200)}`,
      };
    }
    const body = await res.text();
    let cached = false;
    let sawComplete = false;
    let lastErrorMessage: string | null = null;
    for (const line of body.split("\n")) {
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
    if (lastErrorMessage && !sawComplete) {
      return {
        combo,
        outcome: "error",
        elapsedMs: Date.now() - start,
        errorMessage: lastErrorMessage,
      };
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

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  console.log("[seed] signing in...");
  await signIn(context);
  console.log("[seed] signed in OK");

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
      const result = await processCombo(c, context.request);
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

  await context.close();
  await browser.close();

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
