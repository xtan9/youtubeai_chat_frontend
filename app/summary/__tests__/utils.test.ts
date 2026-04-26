import { describe, it, expect } from "vitest";
import { parseStreamingData } from "../utils";

function sse(events: Array<Record<string, unknown>>): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n`).join("\n");
}

describe("parseStreamingData — error event handling", () => {
  it("captures `type: error` events into streamError", () => {
    // Regression guard for the stuck-at-70% UX bug: before this case
    // existed, server-emitted error events were silently dropped and
    // the progress indicator hung at whatever stage fired last.
    const raw = sse([
      { type: "status", message: "Generating summary...", stage: "summarize" },
      {
        type: "error",
        message: "Something went wrong generating the summary. Please try again.",
      },
    ]);
    const parsed = parseStreamingData(raw);
    expect(parsed.streamError).toBe(
      "Something went wrong generating the summary. Please try again."
    );
  });

  it("advances progress to stage=complete on error (stops the spinner)", () => {
    const raw = sse([
      { type: "status", message: "Generating summary...", stage: "summarize" },
      { type: "error", message: "boom" },
    ]);
    const parsed = parseStreamingData(raw);
    expect(parsed.progress?.stage).toBe("complete");
    expect(parsed.progress?.progress).toBe(100);
  });

  it("uses a fallback message when the error event has no message", () => {
    // Defense against a server regression emitting `{type:"error"}` with
    // no message — silent empty banner would be worse than a generic one.
    const raw = sse([{ type: "error" }]);
    const parsed = parseStreamingData(raw);
    expect(parsed.streamError).toBe("Something went wrong. Please try again.");
  });

  it("leaves streamError null on a normal completion path", () => {
    // Happy path must not spuriously flag an error. Pins the invariant
    // that only `type: "error"` events set streamError.
    const raw = sse([
      { type: "metadata", cached: false },
      { type: "status", message: "Extracting captions...", stage: "transcribe" },
      { type: "content", text: "hello " },
      { type: "content", text: "world" },
      {
        type: "summary",
        total_time: 5,
        summarize_time: 3,
        transcribe_time: 2,
      },
    ]);
    const parsed = parseStreamingData(raw);
    expect(parsed.streamError).toBeNull();
    expect(parsed.progress?.progress).toBe(100);
    expect(parsed.result.summary).toBe("hello world");
  });

  it("preserves partial summary text when the stream errors mid-generation", () => {
    // If the LLM emitted some content before failing, don't throw it
    // away — the banner communicates failure, but the partial output
    // (or absence of it) tells the user how close the request got.
    const raw = sse([
      { type: "content", text: "Résumé partiel" },
      { type: "error", message: "gateway timeout" },
    ]);
    const parsed = parseStreamingData(raw);
    expect(parsed.streamError).toBe("gateway timeout");
    expect(parsed.result.summary).toBe("Résumé partiel");
  });
});

describe("parseStreamingData — full_transcript event", () => {
  it("collects segments from the full_transcript event into result.segments", () => {
    // The transcript view depends on these segments — without them the
    // YoutubeVideo card stays empty even after streaming completes. A
    // protocol drift that renamed `segments` would silently regress this.
    const raw = sse([
      { type: "metadata", category: "general", cached: false },
      {
        type: "full_transcript",
        segments: [
          { text: "hello", start: 0, duration: 1.5 },
          { text: "world", start: 1.5, duration: 2 },
        ],
      },
    ]);
    const parsed = parseStreamingData(raw);
    expect(parsed.result.segments).toEqual([
      { text: "hello", start: 0, duration: 1.5 },
      { text: "world", start: 1.5, duration: 2 },
    ]);
  });

  it("filters malformed segment entries instead of crashing", () => {
    // Defense against a partially-buffered SSE chunk landing here with a
    // mid-write segment object. Drop the bad ones, keep the good — better
    // than a thrown error that takes the whole parse with it.
    const raw = sse([
      {
        type: "full_transcript",
        segments: [
          { text: "good", start: 0, duration: 1 },
          { text: "missing duration", start: 5 },
          null,
          "bad",
        ],
      },
    ]);
    const parsed = parseStreamingData(raw);
    expect(parsed.result.segments).toEqual([
      { text: "good", start: 0, duration: 1 },
    ]);
  });

  it("leaves segments undefined when the event is missing the array", () => {
    // Old protocol: `{type:"full_transcript", text:"..."}`. The new parser
    // should not invent segments from the legacy field — let the consumer
    // handle "no segments" the same as "no transcript event at all."
    const raw = sse([{ type: "full_transcript", text: "legacy text" }]);
    const parsed = parseStreamingData(raw);
    expect(parsed.result.segments).toBeUndefined();
  });
});
