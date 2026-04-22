import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CHECK_TIMEOUT_MS = 3000;

type CheckResult = {
  ok: boolean;
  latencyMs: number;
  error?: string;
};

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
    const name = err instanceof Error ? err.name : "Unknown";
    return { ok: false, latencyMs, error: name };
  }
}

type HealthBody = {
  status: "ok" | "degraded";
  checks: Record<string, CheckResult>;
};

export async function GET(): Promise<NextResponse<HealthBody>> {
  const vpsBaseUrl = process.env.VPS_API_URL?.trim();
  const gatewayUrl = process.env.LLM_GATEWAY_URL?.trim();
  const gatewayKey = process.env.LLM_GATEWAY_API_KEY?.trim();

  if (!vpsBaseUrl || !gatewayUrl || !gatewayKey) {
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
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", checks: { vps, llm } },
    { status: ok ? 200 : 503 }
  );
}
