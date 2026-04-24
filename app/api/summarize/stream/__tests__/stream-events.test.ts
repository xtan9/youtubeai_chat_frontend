import { describe, it, expect, vi } from "vitest";
import { forwardLlmEvent, streamCached } from "../stream-events";
import type { CachedSummary } from "@/lib/services/summarize-cache";

function baseCached(overrides: Partial<CachedSummary> = {}): CachedSummary {
  return {
    videoId: "v1",
    title: "T",
    channelName: "C",
    language: "en",
    transcript: "tr",
    summary: "su",
    transcriptSource: "whisper",
    model: "m",
    processingTimeSeconds: 10,
    transcribeTimeSeconds: 4,
    summarizeTimeSeconds: 6,
    enableThinking: false,
    thinking: null,
    ...overrides,
  } as CachedSummary;
}

describe("forwardLlmEvent", () => {
  it("does NOT emit SSE for timing events (route owns terminal summary)", () => {
    const sent: Record<string, unknown>[] = [];
    forwardLlmEvent({ type: "timing", summarizeSeconds: 7 }, (d) =>
      sent.push(d)
    );
    expect(sent).toEqual([]);
  });

  it("passes through content events unchanged", () => {
    const sent: Record<string, unknown>[] = [];
    forwardLlmEvent({ type: "content", text: "abc" }, (d) => sent.push(d));
    expect(sent).toEqual([
      { type: "content", text: "abc" },
    ]);
  });

  it("maps status events with stage", () => {
    const sent: Record<string, unknown>[] = [];
    forwardLlmEvent(
      { type: "status", message: "hi", stage: "summarize" },
      (d) => sent.push(d)
    );
    expect(sent).toEqual([
      { type: "status", message: "hi", stage: "summarize" },
    ]);
  });

  it("logs unknown variant at runtime (defense against future LlmEvent additions)", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const sent: unknown[] = [];
    forwardLlmEvent(
      { type: "future_variant" } as unknown as Parameters<
        typeof forwardLlmEvent
      >[0],
      (d) => sent.push(d)
    );
    expect(sent).toEqual([]);
    expect(err).toHaveBeenCalled();
    expect(err.mock.calls[0][0]).toContain("unknown LlmEvent variant");
  });
});

describe("streamCached event ordering contract", () => {
  it("emits metadata → content → summary in the minimal case", () => {
    const sent: Record<string, unknown>[] = [];
    streamCached((d) => sent.push(d), baseCached(), {
      includeTranscript: false,
    });
    expect(sent.map((e) => e.type)).toEqual(["metadata", "content", "summary"]);
  });

  it("inserts full_transcript between content and summary when requested", () => {
    const sent: Record<string, unknown>[] = [];
    streamCached(
      (d) => sent.push(d),
      baseCached({ transcript: "full transcript" }),
      { includeTranscript: true }
    );
    expect(sent.map((e) => e.type)).toEqual([
      "metadata",
      "content",
      "full_transcript",
      "summary",
    ]);
  });

  it("skips full_transcript when cached transcript is empty", () => {
    const sent: Record<string, unknown>[] = [];
    streamCached(
      (d) => sent.push(d),
      baseCached({ transcript: "" }),
      { includeTranscript: true }
    );
    expect(sent.map((e) => e.type)).toEqual(["metadata", "content", "summary"]);
  });

  it("metadata event carries cached:true + title + channel", () => {
    const sent: Record<string, unknown>[] = [];
    streamCached(
      (d) => sent.push(d),
      baseCached({ title: "MyTitle", channelName: "MyChan" }),
      { includeTranscript: false }
    );
    expect(sent[0]).toEqual({
      type: "metadata",
      category: "general",
      cached: true,
      title: "MyTitle",
      channel: "MyChan",
    });
  });

  it("summary event totals equal summarize + transcribe (matches live path)", () => {
    const sent: Record<string, unknown>[] = [];
    streamCached(
      (d) => sent.push(d),
      baseCached({ transcribeTimeSeconds: 4, summarizeTimeSeconds: 6 }),
      { includeTranscript: false }
    );
    expect(sent.at(-1)).toMatchObject({
      total_time: 10,
      summarize_time: 6,
      transcribe_time: 4,
    });
  });

  it("calls sendEvent in strict order (no interleaving)", () => {
    const sendEvent = vi.fn();
    streamCached(sendEvent, baseCached(), {
      includeTranscript: false,
    });
    const callTypes = sendEvent.mock.calls.map((c) => c[0].type);
    expect(callTypes).toEqual(["metadata", "content", "summary"]);
  });
});
