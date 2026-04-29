// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useChatSuggestions } from "../useChatSuggestions";
import { ChatSuggestionsResponseSchema } from "@/lib/api-contracts/chat";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.restoreAllMocks();
});

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

const VALID_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const fresh = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("useChatSuggestions", () => {
  it("does NOT fire a fetch when enabled=false (lazy — supports the cost claim)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useChatSuggestions(VALID_URL, false), {
      wrapper: wrapper(fresh()),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does NOT fire a fetch when youtubeUrl is null", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useChatSuggestions(null, true), {
      wrapper: wrapper(fresh()),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the parsed suggestions on a 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ suggestions: ["a?", "b?", "c?"] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const { result } = renderHook(
      () => useChatSuggestions(VALID_URL, true),
      { wrapper: wrapper(fresh()) },
    );
    await waitFor(() =>
      expect(result.current.data?.suggestions).toEqual(["a?", "b?", "c?"]),
    );
  });

  it("falls back to empty (NOT isError) when the route returns a 5xx — so the empty state never shows a banner for a nice-to-have", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    const { result } = renderHook(
      () => useChatSuggestions(VALID_URL, true),
      { wrapper: wrapper(fresh()) },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.suggestions).toEqual([]);
    expect(result.current.isError).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      "[useChatSuggestions] fetch failed — using static fallback",
      expect.objectContaining({
        errorId: "CHAT_SUGGESTIONS_FETCH_FAILED",
        status: 503,
      }),
    );
  });

  it("falls back to empty when the response shape drifts from the contract", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ wrongField: ["a?"] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const { result } = renderHook(
      () => useChatSuggestions(VALID_URL, true),
      { wrapper: wrapper(fresh()) },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.suggestions).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      "[useChatSuggestions] response schema drift — using static fallback",
      expect.objectContaining({ errorId: "CHAT_SUGGESTIONS_SCHEMA_DRIFT" }),
    );
  });

  it("the shared response schema is the single source of truth (drift guard)", () => {
    // Both the route's `ChatSuggestionsResponse` typed body and this
    // hook's parser import from `@/lib/api-contracts/chat`, so any
    // future widening of the wire shape lives in one place. This test
    // just pins the shape contract: empty / typical / over-cap.
    expect(
      ChatSuggestionsResponseSchema.safeParse({ suggestions: [] }).success,
    ).toBe(true);
    expect(
      ChatSuggestionsResponseSchema.safeParse({
        suggestions: ["a?", "b?", "c?"],
      }).success,
    ).toBe(true);
    expect(
      ChatSuggestionsResponseSchema.safeParse({
        suggestions: ["a?", "b?", "c?", "d?"],
      }).success,
    ).toBe(false);
  });
});
