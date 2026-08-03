// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPush = vi.fn();
const mockGetSession = vi.fn();
const mockSignInAnonymously = vi.fn();
let mockUserCtx: {
  user: { id: string; is_anonymous?: boolean } | null;
  session: { access_token: string } | null;
};

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

const VALID_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function summaryResponse(cached = false): Response {
  return new Response(
    [
      { type: "metadata", category: "general", cached },
      { type: "content", text: "A complete Summary." },
      {
        type: "summary",
        category: "general",
        total_time: 3,
        transcribe_time: 1,
        summarize_time: 2,
      },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join(""),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("useYouTubeSummarizer", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetSession.mockReset();
    mockSignInAnonymously.mockReset();
    mockUserCtx = { user: null, session: null };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("provisions anonymous access without exposing transport state", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSignInAnonymously.mockResolvedValue({
      data: { session: { access_token: "anon-token" } },
      error: null,
    });

    const { result } = renderHook(() => useYouTubeSummarizer());

    await waitFor(() => expect(result.current.isAnonymous).toBe(true));
    expect(result.current.isAuthLoading).toBe(false);
    expect(mockSignInAnonymously).toHaveBeenCalledTimes(1);
    expect("summarizationQuery" in result.current).toBe(false);
  });

  it("posts the captured request through the lifecycle adapter and exposes a succeeded Summary", async () => {
    mockUserCtx = {
      user: { id: "u1" },
      session: { access_token: "user-token" },
    };
    const fetchMock = vi.fn().mockResolvedValue(summaryResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useYouTubeSummarizer());
    await act(async () => {
      await result.current.start({
        video: { youtubeUrl: VALID_URL },
        outputLanguage: "es",
        includeTranscript: true,
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      youtube_url: VALID_URL,
      include_transcript: true,
      output_language: "es",
    });
    expect(result.current.snapshot).toMatchObject({
      status: "succeeded",
      origin: "cache",
      summary: { summary: "A complete Summary." },
    });
    expect("rawData" in result.current).toBe(false);
  });

  it("redirects an authenticated 401 after the lifecycle records an auth failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockUserCtx = {
      user: { id: "u1" },
      session: { access_token: "user-token" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "session expired" }), {
          status: 401,
        }),
      ),
    );

    const { result } = renderHook(() => useYouTubeSummarizer());
    await act(async () => {
      await result.current.start({
        video: { youtubeUrl: VALID_URL },
        outputLanguage: null,
        includeTranscript: true,
      });
    });

    expect(result.current.snapshot).toMatchObject({
      status: "failed",
      error: { kind: "authentication", status: 401 },
    });
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(mockPush).toHaveBeenCalledWith("/auth/login");
  });
});
