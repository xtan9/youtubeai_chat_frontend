// @vitest-environment happy-dom
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useChatStream } from "../useChatStream";
import { chatThreadQueryKey } from "../useChatThread";
import { useUser } from "@/lib/contexts/user-context";
import { createClient } from "@/lib/supabase/client";
import {
  controlledSseResponse,
  fakeSession,
  freshQueryClient,
  rawSseResponse,
  sseResponse,
} from "@/tests-utils/chat-test-helpers";

// Mock UserContext at module load — every test then dictates session state
// via `(useUser as Mock).mockReturnValue(...)` instead of mounting the real
// provider (which would require a Supabase env at module init).
vi.mock("@/lib/contexts/user-context", () => ({
  useUser: vi.fn(() => ({
    user: null,
    session: null,
    isLoading: false,
    error: null,
  })),
}));

// Mock the supabase browser client. Tests that exercise the anon-fallback
// path swap in their own `getSession` impl; the default returns no session.
const supabaseAuthMock = {
  getSession: vi.fn().mockResolvedValue({
    data: { session: null },
    error: null,
  }),
};
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({ auth: supabaseAuthMock })),
}));

const VALID_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // NB: deliberately NOT calling `vi.restoreAllMocks()` here — it resets
  // the `vi.fn()` implementations supplied to `vi.mock(...)` factories
  // (useUser, createClient), which would leave the next test's hook with
  // a useUser that returns undefined and a destructure crash before
  // renderHook returns. Per-test resets in `beforeEach` cover what we
  // actually need without that side-effect.
});

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function setLiveSession() {
  (useUser as unknown as Mock).mockReturnValue({
    user: null,
    session: fakeSession("live-token"),
    isLoading: false,
    error: null,
  });
}

function setNoSession() {
  (useUser as unknown as Mock).mockReturnValue({
    user: null,
    session: null,
    isLoading: false,
    error: null,
  });
  supabaseAuthMock.getSession.mockResolvedValue({
    data: { session: null },
    error: null,
  });
}

function setAnonFallback(token = "anon-token") {
  (useUser as unknown as Mock).mockReturnValue({
    user: null,
    session: null,
    isLoading: false,
    error: null,
  });
  supabaseAuthMock.getSession.mockResolvedValue({
    data: { session: fakeSession(token) },
    error: null,
  });
}

function setGetSessionThrows() {
  (useUser as unknown as Mock).mockReturnValue({
    user: null,
    session: null,
    isLoading: false,
    error: null,
  });
  supabaseAuthMock.getSession.mockRejectedValue(new Error("network down"));
}

beforeEach(() => {
  // The `vi.mock(...)` factories install module-level mocks once at import
  // time, so a previous test's `mockReturnValue` override survives into the
  // next test. Reset the relevant ones here to a known "no session" baseline
  // and let each test re-configure as needed.
  (useUser as unknown as Mock).mockReturnValue({
    user: null,
    session: null,
    isLoading: false,
    error: null,
  });
  supabaseAuthMock.getSession.mockReset();
  supabaseAuthMock.getSession.mockResolvedValue({
    data: { session: null },
    error: null,
  });
  vi.mocked(createClient).mockReturnValue(
    { auth: supabaseAuthMock } as unknown as ReturnType<typeof createClient>,
  );
});

describe("useChatStream", () => {
  it("uses the live session token and posts the {youtube_url, message} contract without calling getSession", async () => {
    setLiveSession();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse([{ type: "delta", text: "ok" }, { type: "done" }]),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = freshQueryClient();
    const { result } = renderHook(() => useChatStream({ youtubeUrl: VALID_URL }), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.send("what is this video about?");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/chat/stream");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer live-token");
    expect(init.headers["Content-Type"]).toBe("application/json");
    // Assert the wire contract — gateway hotfix #74 was caused by a
    // request-body shape mismatch, so the body keys are load-bearing
    // and worth a regression assertion here.
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      youtube_url: VALID_URL,
      message: "what is this video about?",
    });
    expect(supabaseAuthMock.getSession).not.toHaveBeenCalled();
  });

  it("accumulates delta text into draft.assistant during streaming", async () => {
    setLiveSession();
    const controlled = controlledSseResponse();
    const fetchMock = vi.fn().mockResolvedValue(controlled.response);
    vi.stubGlobal("fetch", fetchMock);
    const client = freshQueryClient();
    const { result } = renderHook(() => useChatStream({ youtubeUrl: VALID_URL }), {
      wrapper: wrapper(client),
    });

    // Start the send but don't await — we want to observe intermediate
    // state while the stream is still open.
    let pending: Promise<void>;
    act(() => {
      pending = result.current.send("hello?");
    });

    await waitFor(() => expect(result.current.streaming).toBe(true));

    act(() => controlled.emit({ type: "delta", text: "Hello" }));
    await waitFor(() =>
      expect(result.current.draft?.assistant).toBe("Hello"),
    );
    expect(result.current.draft?.user).toBe("hello?");

    act(() => controlled.emit({ type: "delta", text: " there" }));
    await waitFor(() =>
      expect(result.current.draft?.assistant).toBe("Hello there"),
    );

    act(() => {
      controlled.emit({ type: "done" });
      controlled.close();
    });
    await act(async () => {
      await pending!;
    });
  });

  it("clears draft and stops streaming after a successful run, then invalidates the thread query", async () => {
    setLiveSession();
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { type: "delta", text: "yes" },
        { type: "done" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = freshQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useChatStream({ youtubeUrl: VALID_URL }), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.send("any?");
    });

    expect(result.current.streaming).toBe(false);
    expect(result.current.draft).toBeNull();
    expect(result.current.error).toBeNull();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: chatThreadQueryKey(VALID_URL),
    });
  });

  it("surfaces an SSE error event as the hook's error state", async () => {
    setLiveSession();
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { type: "delta", text: "starting" },
        { type: "error", message: "model is overloaded" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = freshQueryClient();

    const { result } = renderHook(() => useChatStream({ youtubeUrl: VALID_URL }), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.send("go");
    });

    expect(result.current.error).toBe("model is overloaded");
    expect(result.current.streaming).toBe(false);
    expect(result.current.draft).toBeNull();
  });

  it("surfaces the server's message when the route returns a 4xx with JSON", async () => {
    setLiveSession();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "rate limited" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream({ youtubeUrl: VALID_URL }), {
      wrapper: wrapper(freshQueryClient()),
    });

    await act(async () => {
      await result.current.send("anything");
    });

    expect(result.current.error).toBe("rate limited");
    expect(result.current.streaming).toBe(false);
  });

  it("errors with 'No response received' when the stream finishes without delta events", async () => {
    setLiveSession();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream({ youtubeUrl: VALID_URL }), {
      wrapper: wrapper(freshQueryClient()),
    });

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.error).toBe("No response received.");
  });

  it("does not surface an error on user abort and still invalidates the thread query", async () => {
    setLiveSession();
    const controlled = controlledSseResponse();
    const fetchMock = vi.fn().mockResolvedValue(controlled.response);
    vi.stubGlobal("fetch", fetchMock);
    const client = freshQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useChatStream({ youtubeUrl: VALID_URL }), {
      wrapper: wrapper(client),
    });

    let pending: Promise<void>;
    act(() => {
      pending = result.current.send("long question");
    });
    await waitFor(() => expect(result.current.streaming).toBe(true));

    // The hook's AbortController fires; in production fetch would reject
    // the in-flight reader.read() with AbortError. We simulate that here
    // by erroring the stream with an AbortError DOMException so the
    // hook's catch block sees the same shape.
    act(() => {
      result.current.abort();
      controlled.error(new DOMException("aborted", "AbortError"));
    });
    await act(async () => {
      await pending!;
    });

    expect(result.current.error).toBeNull();
    expect(result.current.streaming).toBe(false);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: chatThreadQueryKey(VALID_URL),
    });
  });

  it("falls back to the anon getSession when there is no live session", async () => {
    setAnonFallback("anon-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse([{ type: "delta", text: "ok" }, { type: "done" }]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream({ youtubeUrl: VALID_URL }), {
      wrapper: wrapper(freshQueryClient()),
    });

    await act(async () => {
      await result.current.send("hi");
    });

    expect(supabaseAuthMock.getSession).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers.Authorization).toBe("Bearer anon-token");
  });

  it("surfaces a 'Setting up your session' message and skips fetch when getSession throws", async () => {
    setGetSessionThrows();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // The hook deliberately logs this class of failure so a structured
    // breadcrumb ties the user-facing toast to the underlying cause.
    // Silence it here to keep the test output clean.
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { result } = renderHook(() => useChatStream({ youtubeUrl: VALID_URL }), {
      wrapper: wrapper(freshQueryClient()),
    });

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.error).toMatch(/setting up your session/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[useChatStream] getSession threw",
      expect.objectContaining({ errorId: "CHAT_GET_SESSION_THREW" }),
    );
    errorSpy.mockRestore();
  });

  it("surfaces a 'Setting up your session' message and skips fetch when no token is available anywhere", async () => {
    setNoSession();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream({ youtubeUrl: VALID_URL }), {
      wrapper: wrapper(freshQueryClient()),
    });

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.error).toMatch(/setting up your session/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores empty and whitespace-only messages without firing a fetch", async () => {
    setLiveSession();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream({ youtubeUrl: VALID_URL }), {
      wrapper: wrapper(freshQueryClient()),
    });

    await act(async () => {
      await result.current.send("");
    });
    await act(async () => {
      await result.current.send("   \n  ");
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.streaming).toBe(false);
  });

  it("warns at most three times for malformed SSE chunks (covers both JSON.parse and zod-rejection branches)", async () => {
    setLiveSession();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Mix `JSON.parse` failures (non-JSON payloads) with `safeParse`
    // failures (well-formed JSON, unknown event shape) so both warn
    // branches in `parseSseLine` are exercised. Five reject candidates
    // (3 JSON-parse + 2 zod-reject) → cap should fire at 3, the trailing
    // valid `delta` + `done` ensures the loop terminates without tripping
    // "no delta received".
    const fetchMock = vi.fn().mockResolvedValue(
      rawSseResponse([
        "data: {not-json-1",
        "data: {not-json-2",
        "data: {not-json-3",
        `data: {"type":"unknown","text":"x"}`,
        `data: {"type":"delta"}`,
        `data: {"type":"delta","text":"x"}`,
        `data: {"type":"done"}`,
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream({ youtubeUrl: VALID_URL }), {
      wrapper: wrapper(freshQueryClient()),
    });

    await act(async () => {
      await result.current.send("hi");
    });

    // Cap is MAX_PARSE_WARNINGS_PER_STREAM (= 3). Five reject candidates
    // → exactly three warn calls. Asserting on the warn payloads also
    // verifies the JSON-parse branch and the zod-reject branch each
    // surface their distinct error ids before the cap silences further
    // calls.
    expect(warnSpy).toHaveBeenCalledTimes(3);
    const warnCalls = warnSpy.mock.calls.map(
      (args) => (args[1] as { errorId?: string } | undefined)?.errorId,
    );
    expect(warnCalls).toContain("CHAT_SSE_PARSE_FAILED");
    expect(result.current.error).toBeNull();
    warnSpy.mockRestore();
  });

  it("carries SSE buffer across chunk boundaries when a single frame is split mid-stream", async () => {
    setLiveSession();
    const controlled = controlledSseResponse();
    const fetchMock = vi.fn().mockResolvedValue(controlled.response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream({ youtubeUrl: VALID_URL }), {
      wrapper: wrapper(freshQueryClient()),
    });

    let pending: Promise<void>;
    act(() => {
      pending = result.current.send("hi");
    });
    await waitFor(() => expect(result.current.streaming).toBe(true));

    // Emit a single SSE frame split across two enqueues — the production
    // hook keeps a per-chunk buffer (`buffer = lines.pop() ?? ""`) so the
    // second half can find the framing newlines from the first. A
    // regression that drops that carry-over would silently turn streaming
    // chunks into "no response received".
    act(() => {
      controlled.enqueueRaw('data: {"type":"delta","text":"split');
    });
    act(() => {
      controlled.enqueueRaw('-frame"}\n\n');
    });
    await waitFor(() =>
      expect(result.current.draft?.assistant).toBe("split-frame"),
    );

    act(() => {
      controlled.emit({ type: "done" });
      controlled.close();
    });
    await act(async () => {
      await pending!;
    });

    expect(result.current.error).toBeNull();
  });

  it("blocks a concurrent send while a stream is already in flight", async () => {
    setLiveSession();
    const controlled = controlledSseResponse();
    const fetchMock = vi.fn().mockResolvedValue(controlled.response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream({ youtubeUrl: VALID_URL }), {
      wrapper: wrapper(freshQueryClient()),
    });

    let firstPending: Promise<void>;
    act(() => {
      firstPending = result.current.send("first");
    });
    await waitFor(() => expect(result.current.streaming).toBe(true));

    // Second send should be a no-op while the first is in flight: still
    // exactly one fetch call, draft.user still reflects the first message.
    await act(async () => {
      await result.current.send("second");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.draft?.user).toBe("first");

    act(() => {
      controlled.emit({ type: "delta", text: "ok" });
      controlled.emit({ type: "done" });
      controlled.close();
    });
    await act(async () => {
      await firstPending!;
    });
  });
});
