import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = global.fetch;

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.resetModules(); // Reset the in-memory cache between tests.
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("LLM_GATEWAY_URL", "https://gw.example.com/v1");
    vi.stubEnv("LLM_GATEWAY_API_KEY", "key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
  });

  it("returns 200 when both downstream checks pass", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));

    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.vps.ok).toBe(true);
    expect(body.checks.llm.ok).toBe(true);
  });

  it("returns 503 when vps is down", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("err", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));

    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.vps.ok).toBe(false);
    expect(body.checks.vps.error).toBe("http_500");
    expect(body.checks.llm.ok).toBe(true);
  });

  it("returns 503 when llm gateway times out", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok" }), { status: 200 }))
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "TimeoutError" }));

    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.checks.llm.ok).toBe(false);
    expect(body.checks.llm.error).toMatch(/TimeoutError/);
  });

  it("caches responses for 20s to prevent DoS amplification", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    global.fetch = fetchMock;

    const { GET } = await import("../route");
    await GET();
    await GET();
    await GET();

    // Three inbound calls, but only one fan-out pair to downstream.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache config-missing responses", async () => {
    vi.stubEnv("VPS_API_URL", "");

    const { GET } = await import("../route");
    const res1 = await GET();
    const res2 = await GET();

    expect(res1.status).toBe(503);
    expect(res2.status).toBe(503);
    // Still 503 both times, but the config fail path never populates the cache.
    const body = await res2.json();
    expect(body.checks.config.error).toBe("missing_env");
  });

  it("returns 503 when env is missing", async () => {
    vi.stubEnv("VPS_API_URL", "");
    vi.stubEnv("LLM_GATEWAY_URL", "");
    vi.stubEnv("LLM_GATEWAY_API_KEY", "");

    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.config.error).toBe("missing_env");
  });

  it("sends Authorization header only to the LLM gateway", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    global.fetch = fetchMock;

    const { GET } = await import("../route");
    await GET();

    const vpsCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes("vps.example.com")
    );
    const llmCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes("gw.example.com")
    );
    expect(vpsCall?.[1]?.headers).toBeUndefined();
    expect(llmCall?.[1]?.headers).toEqual({ Authorization: "Bearer key" });
  });
});
