// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useChatThread } from "../useChatThread";

afterEach(() => cleanup());

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

const VALID_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("useChatThread", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT fire a fetch when enabled=false (lazy)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderHook(() => useChatThread(VALID_URL, false), {
      wrapper: wrapper(client),
    });
    // Give react-query a tick to potentially fire the fetch.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns parsed messages on a valid response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            messages: [
              {
                id: "m1",
                role: "user",
                content: "hi",
                createdAt: "2026-04-28T00:00:00Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useChatThread(VALID_URL, true), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.messages).toHaveLength(1);
    expect(result.current.data?.messages?.[0]?.content).toBe("hi");
  });

  it("rejects malformed responses (zod validation closes the schema-drift hole)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          // Missing required `id` field on the message — schema mismatch.
          JSON.stringify({
            messages: [
              { role: "user", content: "hi", createdAt: "2026-04-28T00:00:00Z" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useChatThread(VALID_URL, true), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/malformed/i);
  });

  it("surfaces server message on 4xx/5xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ message: "rate limited" }),
          { status: 429, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useChatThread(VALID_URL, true), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("rate limited");
  });
});
