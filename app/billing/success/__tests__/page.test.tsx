// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockReplace = vi.fn();
const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
    }),
  };
});

import BillingSuccessPage from "../page";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

describe("BillingSuccessPage", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockInvalidateQueries.mockReset();
    mockInvalidateQueries.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows polling state initially when fetch never resolves", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

    render(<BillingSuccessPage />, { wrapper: makeWrapper() });
    // getByText throws if not found — no jest-dom needed
    screen.getByText(/Confirming your subscription/i);
  });

  it("invalidates entitlements query and shows ok state when tier=pro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ tier: "pro" }), { status: 200 })
      )
    );

    render(<BillingSuccessPage />, { wrapper: makeWrapper() });

    await waitFor(() => {
      screen.getByText(/Welcome to Pro/i);
    });

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["entitlements"],
    });
  });

  it("does not invalidate entitlements when tier is not pro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ tier: "free" }), { status: 200 })
      )
    );

    render(<BillingSuccessPage />, { wrapper: makeWrapper() });

    // Give a couple of real ticks — if it were going to invalidate it would
    // do so synchronously after the resolved fetch.
    await new Promise((r) => setTimeout(r, 50));

    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });
});
