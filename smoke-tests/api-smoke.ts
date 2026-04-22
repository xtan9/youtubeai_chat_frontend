/**
 * Fast API-layer smoke check. Hits /api/health on the prod frontend,
 * which in turn pings the VPS and LLM gateway. Exits non-zero on any
 * failure so CI can gate the slower Playwright run behind it.
 *
 * Invoked via `pnpm smoke:api`. Reads `PROD_URL` from the environment;
 * defaults to the live prod domain so you can `node --env-file=...` with
 * no additional flags.
 */

const DEFAULT_PROD_URL = "https://www.youtubeai.chat";
// /api/health has an internal 3s-per-check budget and two parallel
// checks — 15s overall wraps the request with enough slack for DNS +
// Cold-start + a retry without being so long that a stuck process hangs
// the cron.
const REQUEST_TIMEOUT_MS = 15_000;

type HealthCheck = { ok: boolean; latencyMs: number; error?: string };
type HealthBody = {
  status: "ok" | "degraded";
  checks: Record<string, HealthCheck>;
};

function log(message: string, data?: unknown): void {
  if (data === undefined) {
    console.log(message);
  } else {
    console.log(message, JSON.stringify(data));
  }
}

async function fetchHealth(prodUrl: string): Promise<{
  status: number;
  body: HealthBody | { error: string };
}> {
  const url = `${prodUrl.replace(/\/$/, "")}/api/health`;
  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = { error: "non_json_response" };
  }
  return { status: response.status, body: body as HealthBody };
}

async function main(): Promise<void> {
  const prodUrl = process.env.PROD_URL?.trim() || DEFAULT_PROD_URL;
  log(`[api-smoke] target: ${prodUrl}`);

  const { status, body } = await fetchHealth(prodUrl);
  log(`[api-smoke] /api/health status=${status}`, body);

  if (status !== 200) {
    log("[api-smoke] FAIL: health endpoint returned non-200");
    process.exit(1);
  }
  const healthy = body as HealthBody;
  if (healthy.status !== "ok") {
    log("[api-smoke] FAIL: health status != ok");
    process.exit(1);
  }
  for (const [name, check] of Object.entries(healthy.checks)) {
    if (!check.ok) {
      log(`[api-smoke] FAIL: downstream ${name} is unhealthy`, check);
      process.exit(1);
    }
  }
  log("[api-smoke] PASS");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  log(`[api-smoke] FAIL: uncaught error: ${message}`);
  process.exit(1);
});
