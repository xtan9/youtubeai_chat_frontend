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
  it("converts timing event to SSE summary with summarize+transcribe total", () => {
    const sent: Record<string, unknown>[] = [];
    forwardLlmEvent(
      {
        type: "timing",
        totalSeconds: 7,
        summarizeSeconds: 7,
        transcribeSeconds: 0,
      },
      (d) => sent.push(d),
      3
    );
    expect(sent).toEqual([
      {
        type: "summary",
        category: "general",
        total_time: 10, // summarize 7 + transcribe 3
        summarize_time: 7,
        transcribe_time: 3,
      },
    ]);
  });

  it("passes through content and thinking events unchanged", () => {
    const sent: Record<string, unknown>[] = [];
    forwardLlmEvent(
      { type: "content", text: "abc" },
      (d) => sent.push(d),
      0
    );
    forwardLlmEvent(
      { type: "thinking", text: "deep" },
      (d) => sent.push(d),
      0
    );
    expect(sent).toEqual([
      { type: "content", text: "abc" },
      { type: "thinking", text: "deep" },
    ]);
  });

  it("maps status events with stage", () => {
    const sent: Record<string, unknown>[] = [];
    forwardLlmEvent(
      { type: "status", message: "hi", stage: "summarize" },
      (d) => sent.push(d),
      0
    );
    expect(sent).toEqual([
      { type: "status", message: "hi", stage: "summarize" },
    ]);
  });
});

describe("streamCached event ordering contract", () => {
  it("emits metadata → content → summary in the minimal case", () => {
    const sent: Record<string, unknown>[] = [];
    streamCached(
      (d) => sent.push(d),
      baseCached(),
      { enableThinking: false, includeTranscript: false }
    );
    const types = sent.map((e) => e.type);
    expect(types).toEqual(["metadata", "content", "summary"]);
  });

  it("inserts thinking after metadata when both cached and requested", () => {
    const sent: Record<string, unknown>[] = [];
    streamCached(
      (d) => sent.push(d),
      baseCached({ enableThinking: true, thinking: "deep thoughts" }),
      { enableThinking: true, includeTranscript: false }
    );
    const types = sent.map((e) => e.type);
    expect(types).toEqual(["metadata", "thinking", "content", "summary"]);
  });

  it("skips thinking when cached row has no thinking text", () => {
    const sent: Record<string, unknown>[] = [];
    streamCached(
      (d) => sent.push(d),
      baseCached({ enableThinking: true, thinking: null }),
      { enableThinking: true, includeTranscript: false }
    );
    const types = sent.map((e) => e.type);
    expect(types).toEqual(["metadata", "content", "summary"]);
  });

  it("inserts full_transcript between content and summary when requested", () => {
    const sent: Record<string, unknown>[] = [];
    streamCached(
      (d) => sent.push(d),
      baseCached({ transcript: "full transcript" }),
      { enableThinking: false, includeTranscript: true }
    );
    const types = sent.map((e) => e.type);
    expect(types).toEqual(["metadata", "content", "full_transcript", "summary"]);
  });

  it("skips full_transcript when cached transcript is empty", () => {
    const sent: Record<string, unknown>[] = [];
    streamCached(
      (d) => sent.push(d),
      baseCached({ transcript: "" }),
      { enableThinking: false, includeTranscript: true }
    );
    const types = sent.map((e) => e.type);
    expect(types).toEqual(["metadata", "content", "summary"]);
  });

  it("metadata event carries cached:true + title + channel", () => {
    const sent: Record<string, unknown>[] = [];
    streamCached(
      (d) => sent.push(d),
      baseCached({ title: "MyTitle", channelName: "MyChan" }),
      { enableThinking: false, includeTranscript: false }
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
      { enableThinking: false, includeTranscript: false }
    );
    const summary = sent.at(-1)!;
    expect(summary).toMatchObject({
      total_time: 10,
      summarize_time: 6,
      transcribe_time: 4,
    });
  });

  it("calls sendEvent in strict order (no interleaving)", () => {
    const sendEvent = vi.fn();
    streamCached(sendEvent, baseCached(), {
      enableThinking: false,
      includeTranscript: false,
    });
    const callTypes = sendEvent.mock.calls.map((c) => c[0].type);
    expect(callTypes).toEqual(["metadata", "content", "summary"]);
  });
});
