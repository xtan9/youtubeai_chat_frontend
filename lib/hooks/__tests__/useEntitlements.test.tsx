// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEntitlements } from "../useEntitlements";

function freshQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useEntitlements", () => {
  it("fetches and returns the entitlement payload (free tier)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          tier: "free",
          caps: { summariesUsed: 3, summariesLimit: 10, historyUsed: 7, historyLimit: 10 },
        }),
        { status: 200 }
      )
    );
    const qc = freshQueryClient();
    const { result } = renderHook(() => useEntitlements(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.tier).toBe("free");
    expect(result.current.data?.caps.summariesUsed).toBe(3);
    expect(result.current.data?.caps.summariesLimit).toBe(10);
  });

  it("returns pro tier with subscription details", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          tier: "pro",
          caps: { summariesUsed: 0, summariesLimit: -1, historyUsed: 0, historyLimit: -1 },
          subscription: { plan: "yearly", current_period_end: "2027-04-01T00:00:00Z", cancel_at_period_end: false },
        }),
        { status: 200 }
      )
    );
    const qc = freshQueryClient();
    const { result } = renderHook(() => useEntitlements(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.tier).toBe("pro");
    expect(result.current.data?.caps.summariesLimit).toBe(-1);
    expect(result.current.data?.subscription?.plan).toBe("yearly");
  });

  it("returns isError when fetch rejects", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("boom"));
    const qc = freshQueryClient();
    const { result } = renderHook(() => useEntitlements(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("returns isError when response is non-ok", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("server error", { status: 503 })
    );
    const qc = freshQueryClient();
    const { result } = renderHook(() => useEntitlements(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("logs console.error with errorId when fetch rejects", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network failure"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const qc = freshQueryClient();
    const { result } = renderHook(() => useEntitlements(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(errSpy).toHaveBeenCalledWith(
      "[useEntitlements] fetch failed (paywall surfaces will silently degrade)",
      expect.objectContaining({ errorId: "USE_ENTITLEMENTS_FETCH_FAIL" })
    );
  });
});
