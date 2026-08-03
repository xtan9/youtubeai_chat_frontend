import { describe, it, expect } from "vitest";
import { parseStreamingData } from "../utils";
import { SummaryStreamProtocolError } from "@/lib/api-contracts/summary";

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

  it("preserves a typed service error ID for safe browser diagnostics", () => {
    const parsed = parseStreamingData(
      sse([
        {
          type: "error",
          message: "Couldn't process this video.",
          errorId: "VPS_TRANSCRIBE_FAILED_HTTP_503",
        },
      ])
    );

    expect(parsed.streamErrorId).toBe("VPS_TRANSCRIBE_FAILED_HTTP_503");
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

  it("rejects an error event with no message", () => {
    // Defense against a server regression emitting `{type:"error"}` with
    // no message — silent empty banner would be worse than a generic one.
    const raw = sse([{ type: "error" }]);
    expect(() => parseStreamingData(raw)).toThrowError(
      expect.objectContaining<Partial<SummaryStreamProtocolError>>({
        code: "invalid_event",
      }),
    );
  });

  it("leaves streamError null on a normal completion path", () => {
    // Happy path must not spuriously flag an error. Pins the invariant
    // that only `type: "error"` events set streamError.
    const raw = sse([
      { type: "metadata", category: "general", cached: false },
      { type: "status", message: "Extracting captions...", stage: "transcribe" },
      { type: "content", text: "hello " },
      { type: "content", text: "world" },
      {
        type: "summary",
        category: "general",
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
        source: "whisper",
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
    expect(parsed.result.transcriptSource).toBe("whisper");
  });

  it("rejects malformed segment entries as an invalid full transcript", () => {
    // A malformed transcript must be distinguishable from an invalid
    // non-transcript event so the UI can degrade that part independently.
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
    expect(() => parseStreamingData(raw)).toThrowError(
      expect.objectContaining<Partial<SummaryStreamProtocolError>>({
        code: "invalid_full_transcript",
      }),
    );
  });

  it("rejects the legacy full transcript shape", () => {
    // Old protocol: `{type:"full_transcript", text:"..."}`. The new parser
    // should not invent segments from the legacy field — let the consumer
    // handle "no segments" the same as "no transcript event at all."
    const raw = sse([{ type: "full_transcript", text: "legacy text" }]);
    expect(() => parseStreamingData(raw)).toThrowError(
      expect.objectContaining<Partial<SummaryStreamProtocolError>>({
        code: "invalid_full_transcript",
      }),
    );
  });
});

describe("parseStreamingData - protocol failures", () => {
  it.each([
    ["malformed JSON", "data: {not-json\n\n", "malformed_json"],
    ["empty JSON", "data: \n\n", "malformed_json"],
    ["unknown variants", sse([{ type: "future_event" }]), "unknown_event_variant"],
    ["type-invalid events", sse([{ type: "content", text: 42 }]), "invalid_event"],
    [
      "type-invalid full transcripts",
      sse([{ type: "full_transcript", segments: "not-an-array" }]),
      "invalid_full_transcript",
    ],
  ])("rejects %s as a typed protocol error", (_label, raw, code) => {
    expect(() => parseStreamingData(raw)).toThrowError(
      expect.objectContaining<Partial<SummaryStreamProtocolError>>({
        code: code as SummaryStreamProtocolError["code"],
      }),
    );
  });
});
