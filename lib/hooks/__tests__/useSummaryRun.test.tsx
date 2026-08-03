// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSummaryRun } from "../useSummaryRun";

const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function responseFor(events: string[]): Response {
  const wire = events.map((payload) => `data: ${payload}\n\n`).join("");
  return new Response(wire, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("useSummaryRun", () => {
  it.each([
    { cached: false, origin: "generated" as const },
    { cached: true, origin: "cache" as const },
  ])(
    "exposes only the lifecycle snapshot and explicit commands for a $origin run",
    async ({ cached, origin }) => {
      const fetchMock = vi.fn().mockResolvedValue(
        responseFor([
          JSON.stringify({ type: "metadata", category: "general", cached }),
          JSON.stringify({ type: "content", text: "Cached draft" }),
          JSON.stringify({
            type: "summary",
            category: "general",
            total_time: 1,
            transcribe_time: 0,
            summarize_time: 1,
          }),
        ]),
      );
      const { result } = renderHook(() =>
        useSummaryRun({
          fetch: fetchMock,
          getAccessToken: () => "token",
        }),
      );

      expect(result.current.snapshot).toEqual({ status: "idle" });
      expect(typeof result.current.start).toBe("function");
      expect(typeof result.current.cancel).toBe("function");
      expect(typeof result.current.retry).toBe("function");
      expect("rawData" in result.current).toBe(false);
      expect("query" in result.current).toBe(false);

      await act(async () => {
        await result.current.start({
          video: { youtubeUrl: VIDEO_URL },
          outputLanguage: null,
          includeTranscript: false,
        });
      });

      expect(result.current.snapshot).toMatchObject({
        status: "succeeded",
        origin,
        summary: { summary: "Cached draft" },
      });
    },
  );

  it("forwards only explicit retry with the terminal run's exact captured inputs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        responseFor([
          JSON.stringify({
            type: "metadata",
            category: "general",
            cached: false,
          }),
          JSON.stringify({ type: "content", text: "incomplete draft" }),
          JSON.stringify({
            type: "error",
            message: "private server exception",
            errorId: "PRIVATE_SERVER_ERROR",
          }),
        ]),
      )
      .mockResolvedValueOnce(
        responseFor([
          JSON.stringify({ type: "metadata", category: "general", cached: true }),
          JSON.stringify({ type: "content", text: "retried Summary" }),
          JSON.stringify({
            type: "summary",
            category: "general",
            total_time: 1,
            transcribe_time: 0,
            summarize_time: 1,
          }),
        ]),
      );
    const { result } = renderHook(() =>
      useSummaryRun({
        fetch: fetchMock,
        getAccessToken: () => "token",
        createRunId: vi
          .fn()
          .mockReturnValueOnce("failed-run")
          .mockReturnValueOnce("retried-run"),
      }),
    );
    const mutableInput = {
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: "es" as const,
      includeTranscript: true,
    };

    await act(async () => {
      await result.current.start(mutableInput);
    });
    mutableInput.video.youtubeUrl = "https://www.youtube.com/watch?v=mutated";

    expect(result.current.snapshot).toMatchObject({
      status: "failed",
      runId: "failed-run",
      input: {
        video: { youtubeUrl: VIDEO_URL },
        outputLanguage: "es",
        includeTranscript: true,
      },
      error: {
        kind: "processing",
        code: "PROCESSING_FAILURE",
        message:
          "Couldn't process this video. Please try again or try a different URL.",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.retry();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.snapshot).toMatchObject({
      status: "succeeded",
      runId: "retried-run",
      summary: { summary: "retried Summary" },
    });
    for (const call of fetchMock.mock.calls) {
      const [, init] = call as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        youtube_url: VIDEO_URL,
        include_transcript: true,
        output_language: "es",
      });
    }
  });
});
