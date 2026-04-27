// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockPush = vi.fn();
const mockGetSession = vi.fn();
const mockSignInAnonymously = vi.fn();
let mockUserCtx: { user: unknown; session: { access_token: string } | null };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/contexts/user-context", () => ({
  useUser: () => mockUserCtx,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
      signInAnonymously: mockSignInAnonymously,
    },
  }),
}));

import { useYouTubeSummarizer } from "../useYouTubeSummarizer";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

function sseStream(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
  return new Response(body, { status: 200 });
}

describe("useYouTubeSummarizer", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetSession.mockReset();
    mockSignInAnonymously.mockReset();
    mockUserCtx = { user: null, session: null };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("provisions an anonymous session when user is logged out and none exists", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSignInAnonymously.mockResolvedValue({
      data: { session: { access_token: "anon-token" } },
      error: null,
    });
    const { result } = renderHook(
      () => useYouTubeSummarizer("https://youtu.be/x"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isAnonymous).toBe(true));
    expect(mockSignInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing anonymous session without re-signing", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "existing-anon" } },
    });
    const { result } = renderHook(
      () => useYouTubeSummarizer("https://youtu.be/x"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isAnonymous).toBe(true));
    expect(mockSignInAnonymously).not.toHaveBeenCalled();
  });

  it("does not provision an anonymous session when a user session exists", async () => {
    mockUserCtx = {
      user: { id: "u1" },
      session: { access_token: "user-token" },
    };
    const { result } = renderHook(
      () => useYouTubeSummarizer("https://youtu.be/x"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isAuthLoading).toBe(false));
    expect(result.current.isAnonymous).toBe(false);
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockSignInAnonymously).not.toHaveBeenCalled();
  });

  it("query is disabled by default (does not fire on mount)", async () => {
    mockUserCtx = {
      user: { id: "u1" },
      session: { access_token: "user-token" },
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useYouTubeSummarizer("https://youtu.be/x"), {
      wrapper: makeWrapper(),
    });
    // Give react-query a microtask tick
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to /api/summarize/stream with bearer token and yields streamed summary", async () => {
    mockUserCtx = {
      user: { id: "u1" },
      session: { access_token: "user-token" },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseStream(["partial-1 ", "partial-2"]));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () => useYouTubeSummarizer("https://youtu.be/x", true, null),
      { wrapper: makeWrapper() }
    );

    let refetchResult: Awaited<
      ReturnType<typeof result.current.summarizationQuery.refetch>
    >;
    await act(async () => {
      refetchResult = await result.current.summarizationQuery.refetch();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/summarize/stream");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer user-token"
    );
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      youtube_url: "https://youtu.be/x",
      include_transcript: true,
      // outputLanguage=null must NOT serialize the field
    });

    // Use refetch result directly since the hook re-render may be async
    const data = refetchResult!.data;
    expect(Array.isArray(data)).toBe(true);
    expect(data!.at(-1)?.summary).toBe("partial-1 partial-2");
    // Two chunks → two intermediate yields (catches a regression to
    // batch-yielding the full string at the end).
    expect(data).toHaveLength(2);
    expect(data![0].summary).toBe("partial-1 ");
    // signal must thread through to fetch — drops would silently break abort.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("includes output_language in body only when provided", async () => {
    mockUserCtx = {
      user: { id: "u1" },
      session: { access_token: "user-token" },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseStream(["x"]));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () => useYouTubeSummarizer("https://youtu.be/x", true, "es"),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      await result.current.summarizationQuery.refetch();
    });

    const body = JSON.parse(
      fetchMock.mock.calls[0][1].body as string
    );
    expect(body.output_language).toBe("es");
  });

  it("throws if no auth token is available when fetch starts", async () => {
    // No user session, anonymous resolution returns null
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSignInAnonymously.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () => useYouTubeSummarizer("https://youtu.be/x"),
      { wrapper: makeWrapper() }
    );

    // Wait for anon-resolution attempt to settle
    await waitFor(() => expect(result.current.isAuthLoading).toBe(false));

    await act(async () => {
      const r = await result.current.summarizationQuery.refetch();
      expect(r.isError).toBe(true);
      expect(r.error?.message).toMatch(/No authentication available/);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redirects to /auth/login on 401 for an authenticated user", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockUserCtx = {
      user: { id: "u1" },
      session: { access_token: "user-token" },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message: "session expired" }),
        { status: 401 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () => useYouTubeSummarizer("https://youtu.be/x"),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      const r = await result.current.summarizationQuery.refetch();
      expect(r.isError).toBe(true);
    });

    // Push must be scheduled, not fired synchronously.
    expect(mockPush).not.toHaveBeenCalled();

    // The hook schedules push via setTimeout; advance to fire it.
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(mockPush).toHaveBeenCalledWith("/auth/login");
    // retry:false is honored despite the hook's retry:1 — the QueryClient
    // defaultOptions take precedence when the test client overrides them.
    // Pin the count so a future change to retry policy is visible here.
    expect(mockPush).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("does NOT redirect on 403 (only 401 redirects per getAuthErrorInfo)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockUserCtx = {
      user: { id: "u1" },
      session: { access_token: "user-token" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ message: "forbidden" }),
            { status: 403 }
          )
        )
      )
    );

    const { result } = renderHook(
      () => useYouTubeSummarizer("https://youtu.be/x"),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      const r = await result.current.summarizationQuery.refetch();
      expect(r.isError).toBe(true);
      expect(r.error?.message).toBe("forbidden");
    });

    // Advance well past any conceivable redirect delay.
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(mockPush).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("falls back to default message when error response has no message field", async () => {
    mockUserCtx = {
      user: { id: "u1" },
      session: { access_token: "user-token" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({}), { status: 500 }))
      )
    );

    const { result } = renderHook(
      () => useYouTubeSummarizer("https://youtu.be/x"),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      const r = await result.current.summarizationQuery.refetch();
      expect(r.isError).toBe(true);
      expect(r.error?.message).toBe(
        "Failed to start streaming summarization"
      );
    });
  });

  it("throws 'Failed to get response reader' when response body is null", async () => {
    mockUserCtx = {
      user: { id: "u1" },
      session: { access_token: "user-token" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    );

    const { result } = renderHook(
      () => useYouTubeSummarizer("https://youtu.be/x"),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      const r = await result.current.summarizationQuery.refetch();
      expect(r.isError).toBe(true);
      expect(r.error?.message).toBe("Failed to get response reader");
    });
  });

  it("logs error when signInAnonymously returns an error and stays unauthenticated", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSignInAnonymously.mockResolvedValue({
      data: { session: null },
      error: new Error("anon sign-in failed"),
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(
      () => useYouTubeSummarizer("https://youtu.be/x"),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isAuthLoading).toBe(false));
    expect(result.current.isAnonymous).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(
      "Anonymous sign-in error:",
      expect.any(Error)
    );
  });
});
