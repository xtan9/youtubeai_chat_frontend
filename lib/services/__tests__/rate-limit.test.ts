import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createClient: vi.fn(() => ({ rpc: mocks.rpc })),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

async function loadFreshModule() {
  vi.resetModules();
  return await import("../rate-limit");
}

describe("getWindowStart", () => {
  it("floors timestamp to the start of the current minute", async () => {
    const { getWindowStart } = await loadFreshModule();
    const date = new Date("2026-04-17T10:30:45.123Z");
    expect(getWindowStart(date).toISOString()).toBe("2026-04-17T10:30:00.000Z");
  });
});

describe("RATE_LIMITS", () => {
  it("has correct limits", async () => {
    const { RATE_LIMITS } = await loadFreshModule();
    expect(RATE_LIMITS.anonymous).toBe(10);
    expect(RATE_LIMITS.authenticated).toBe(30);
  });
});

describe("checkRateLimit", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.createClient.mockClear();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails open AND logs when service-role creds missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { checkRateLimit, RATE_LIMITS } = await loadFreshModule();
    const res = await checkRateLimit("u1", true);
    expect(res).toEqual({ allowed: true, remaining: RATE_LIMITS.anonymous });
    expect(warn).toHaveBeenCalled();
  });

  it("logs error level in production when creds missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const { checkRateLimit } = await loadFreshModule();
    await checkRateLimit("u1", false);
    expect(error).toHaveBeenCalled();
  });

  it("returns allowed:true with remaining=limit-count when under limit", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.rpc.mockResolvedValue({ data: 5, error: null });

    const { checkRateLimit } = await loadFreshModule();
    const res = await checkRateLimit("u1", false);
    expect(res).toEqual({ allowed: true, remaining: 25 });
  });

  it("allows at the boundary (count === limit)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.rpc.mockResolvedValue({ data: 30, error: null });

    const { checkRateLimit } = await loadFreshModule();
    const res = await checkRateLimit("u1", false);
    expect(res).toEqual({ allowed: true, remaining: 0 });
  });

  it("denies when count exceeds limit", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.rpc.mockResolvedValue({ data: 31, error: null });

    const { checkRateLimit } = await loadFreshModule();
    const res = await checkRateLimit("u1", false);
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
  });

  it("uses correct limit for anonymous vs authenticated", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.rpc.mockResolvedValue({ data: 11, error: null });

    const { checkRateLimit } = await loadFreshModule();
    const anon = await checkRateLimit("u1", true);
    const auth = await checkRateLimit("u1", false);
    expect(anon.allowed).toBe(false);
    expect(auth.allowed).toBe(true);
  });

  it("logs with deploy-defect marker on code 42883 (RPC missing)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "42883", message: "function does not exist" },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const { checkRateLimit } = await loadFreshModule();
    const res = await checkRateLimit("u1", true);
    expect(res.allowed).toBe(true);
    expect(error.mock.calls[0][0]).toContain("deploy-defect");
  });

  it("fails open on non-numeric RPC data", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.rpc.mockResolvedValue({ data: "nope", error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { checkRateLimit, RATE_LIMITS } = await loadFreshModule();
    const res = await checkRateLimit("u1", false);
    expect(res).toEqual({
      allowed: true,
      remaining: RATE_LIMITS.authenticated,
    });
  });

  it("fails open on thrown RPC", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.rpc.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { checkRateLimit, RATE_LIMITS } = await loadFreshModule();
    const res = await checkRateLimit("u1", true);
    expect(res).toEqual({ allowed: true, remaining: RATE_LIMITS.anonymous });
  });

  it("memoizes the Supabase client across calls", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
    mocks.rpc.mockResolvedValue({ data: 1, error: null });

    const { checkRateLimit } = await loadFreshModule();
    await checkRateLimit("u1", false);
    await checkRateLimit("u1", false);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });
});
