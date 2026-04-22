import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CHECK_TIMEOUT_MS = 3000;
// Endpoint is unauthenticated so the smoke runner can reach it without
// secrets. The trade-off is that each public request fans out to two
// internal services — without a cache, a trivial loop against
// /api/health turns the public edge into a DoS amplifier for the VPS
// and LLM gateway. A 20s TTL collapses bursts to one upstream probe
// while still catching a real outage within the hourly smoke window.
const HEALTH_CACHE_TTL_MS = 20_000;

type CheckResult = {
  ok: boolean;
  latencyMs: number;
  error?: string;
};

type HealthBody = {
  status: "ok" | "degraded";
  checks: Record<string, CheckResult>;
};

type CachedResponse = {
  expiresAt: number;
  status: number;
  body: HealthBody;
};

let cached: CachedResponse | null = null;

async function ping(
  url: string,
  headers?: Record<string, string>
): Promise<CheckResult> {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      cache: "no-store",
    });
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      return { ok: false, latencyMs, error: `http_${response.status}` };
    }
    return { ok: true, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - started;
    // Preserve the specific message alongside the class name — "TypeError"
    // alone doesn't distinguish DNS vs TLS vs refused, which is exactly
    // the info on-call needs at 2am.
    if (err instanceof Error) {
      return {
        ok: false,
        latencyMs,
        error: `${err.name}: ${err.message}`.slice(0, 200),
      };
    }
    return { ok: false, latencyMs, error: "Unknown" };
  }
}

export async function GET(): Promise<NextResponse<HealthBody>> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.body, { status: cached.status });
  }

  const vpsBaseUrl = process.env.VPS_API_URL?.trim();
  const gatewayUrl = process.env.LLM_GATEWAY_URL?.trim();
  const gatewayKey = process.env.LLM_GATEWAY_API_KEY?.trim();

  if (!vpsBaseUrl || !gatewayUrl || !gatewayKey) {
    // Config failures aren't cached — the common cause is a misconfigured
    // preview deployment and the ops fix is immediate.
    return NextResponse.json(
      {
        status: "degraded",
        checks: {
          config: { ok: false, latencyMs: 0, error: "missing_env" },
        },
      },
      { status: 503 }
    );
  }

  const [vps, llm] = await Promise.all([
    ping(`${vpsBaseUrl.replace(/\/$/, "")}/health`),
    ping(`${gatewayUrl.replace(/\/$/, "")}/models`, {
      Authorization: `Bearer ${gatewayKey}`,
    }),
  ]);

  const ok = vps.ok && llm.ok;
  const body: HealthBody = {
    status: ok ? "ok" : "degraded",
    checks: { vps, llm },
  };
  const status = ok ? 200 : 503;
  cached = { expiresAt: now + HEALTH_CACHE_TTL_MS, status, body };
  return NextResponse.json(body, { status });
}
