// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { useContinueLearning } from "../useContinueLearning";

const SOURCE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const READY = {
  outcome: "ready" as const,
  setVersionToken: "cl1s.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  items: [
    {
      token: "cl1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ordinal: 1,
      canonicalUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0",
      title: "A next lesson",
      channelName: "Teaching Channel",
      thumbnailUrl: "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg",
      relationship: "deeper_explanation" as const,
      explanation: "Builds on the source concept.",
    },
  ],
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("useContinueLearning", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads a ready response and encodes the source URL", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(response(READY));
    const { result } = renderHook(() =>
      useContinueLearning(SOURCE_URL, { enabled: true }),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/continue-learning?youtube_url=${encodeURIComponent(SOURCE_URL)}`,
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data).toEqual(READY);
  });

  it("polls pending preparation until a ready response arrives", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(response({ outcome: "pending" }))
      .mockResolvedValueOnce(response(READY));
    const { result } = renderHook(() =>
      useContinueLearning(SOURCE_URL, { enabled: true }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe("pending");
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("ready");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale response after the source changes", async () => {
    let resolveFirst!: (value: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(response(READY));
    const { result, rerender } = renderHook(
      ({ source }: { source: string }) =>
        useContinueLearning(source, { enabled: true }),
      { initialProps: { source: SOURCE_URL } },
    );

    rerender({ source: "https://youtu.be/another-source" });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => {
      resolveFirst(response(READY));
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data?.items[0].canonicalUrl).toContain("9bZkp7q19f0");
  });

  it("cancels pending polling on unmount and times out fail-soft", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(response({ outcome: "pending" }));
    const { result, unmount } = renderHook(() =>
      useContinueLearning(SOURCE_URL, { enabled: true }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe("pending");
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("ends a pending preparation at the bounded deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(global, "fetch").mockResolvedValue(response({ outcome: "pending" }));
    const { result } = renderHook(() =>
      useContinueLearning(SOURCE_URL, {
        enabled: true,
        intervalMs: 2,
        maxWaitMs: 5,
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("pending");
    await act(async () => {
      vi.advanceTimersByTime(5);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("unavailable");
  });

  it("aborts a hung request at the bounded deadline", async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    vi.spyOn(global, "fetch").mockImplementation((_input, init) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>(() => {});
    });
    const { result } = renderHook(() =>
      useContinueLearning(SOURCE_URL, { enabled: true, maxWaitMs: 5 }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(5);
      await Promise.resolve();
    });
    expect(signal.aborted).toBe(true);
    expect(result.current.status).toBe("unavailable");
  });
});
