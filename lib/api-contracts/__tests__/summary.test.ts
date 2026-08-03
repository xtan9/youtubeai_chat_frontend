import { describe, expect, it } from "vitest";
import {
  SummaryRequestSchema,
  SummarySseEventSchema,
  SummarySseStreamDecoder,
  SummaryStreamProtocolError,
  SUPPORTED_SUMMARY_EVENT_TYPES,
  type SummarySseEvent,
} from "@/lib/api-contracts/summary";
import { SUPPORTED_LANGUAGE_CODES } from "@/lib/constants/languages";

const VALID_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function frame(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

describe("Summary request contract", () => {
  it("accepts every supported request field variant", () => {
    expect(
      SummaryRequestSchema.safeParse({
        youtube_url: VALID_URL,
      }).success,
    ).toBe(true);
    expect(
      SummaryRequestSchema.safeParse({
        youtube_url: VALID_URL,
        include_transcript: false,
      }).success,
    ).toBe(true);
    expect(
      SummaryRequestSchema.safeParse({
        youtube_url: VALID_URL,
        include_transcript: true,
        output_language: SUPPORTED_LANGUAGE_CODES[0],
      }).success,
    ).toBe(true);

    for (const outputLanguage of SUPPORTED_LANGUAGE_CODES) {
      expect(
        SummaryRequestSchema.safeParse({
          youtube_url: VALID_URL,
          include_transcript: true,
          output_language: outputLanguage,
        }).success,
      ).toBe(true);
    }
  });

  it("preserves the endpoint's default for omitted include_transcript", () => {
    expect(SummaryRequestSchema.parse({ youtube_url: VALID_URL })).toMatchObject({
      youtube_url: VALID_URL,
      include_transcript: false,
    });
  });

  it("rejects malformed request fields", () => {
    expect(
      SummaryRequestSchema.safeParse({
        youtube_url: VALID_URL,
        include_transcript: "yes",
      }).success,
    ).toBe(false);
    expect(
      SummaryRequestSchema.safeParse({
        youtube_url: VALID_URL,
        output_language: "klingon",
      }).success,
    ).toBe(false);
  });
});

describe("Summary SSE event contract", () => {
  const supportedEvents: SummarySseEvent[] = [
    { type: "status", message: "Extracting captions...", stage: "transcribe" },
    { type: "status", message: "Generating summary...", stage: "summarize" },
    { type: "content", text: "A summary fragment." },
    {
      type: "metadata",
      category: "general",
      cached: false,
    },
    {
      type: "metadata",
      category: "general",
      cached: true,
      title: "A cached video",
      channel: "A channel",
    },
    {
      type: "full_transcript",
      segments: [{ text: "Transcript line", start: 0, duration: 1.25 }],
      source: "manual_captions",
    },
    {
      type: "full_transcript",
      segments: [{ text: "Transcript line", start: 0, duration: 1.25 }],
      source: "auto_captions",
    },
    {
      type: "full_transcript",
      segments: [{ text: "Transcript line", start: 0, duration: 1.25 }],
      source: "whisper",
    },
    {
      type: "summary",
      category: "general",
      total_time: 5.5,
      summarize_time: 3.25,
      transcribe_time: 2.25,
    },
    { type: "error", message: "Couldn't process this video." },
    {
      type: "error",
      message: "The model returned no summary.",
      errorId: "SUMMARY_EMPTY_RESULT",
    },
  ];

  it("accepts every supported event variant", () => {
    expect(
      supportedEvents.map((event) => SummarySseEventSchema.safeParse(event).success),
    ).toEqual(supportedEvents.map(() => true));
    expect(
      new Set(supportedEvents.map((event) => event.type)),
    ).toEqual(new Set(SUPPORTED_SUMMARY_EVENT_TYPES));
  });

  it.each([
    ["content", { type: "content", text: 123 }],
    ["metadata", { type: "metadata", category: "general", cached: "yes" }],
    ["summary", { type: "summary", category: "general", total_time: -1, summarize_time: 1, transcribe_time: 1 }],
    ["error", { type: "error", message: { text: "not a string" } }],
  ])("rejects a type-invalid %s event", (_label, event) => {
    expect(SummarySseEventSchema.safeParse(event).success).toBe(false);
  });

  it("rejects an unknown event variant", () => {
    expect(
      SummarySseEventSchema.safeParse({ type: "future_event", value: "x" }).success,
    ).toBe(false);
  });

  it("classifies malformed JSON, unknown variants, and invalid full transcripts distinctly", () => {
    const decoder = new SummarySseStreamDecoder();

    expect(() => decoder.push("data: {not-json\n\n")).toThrowError(
      expect.objectContaining<Partial<SummaryStreamProtocolError>>({
        code: "malformed_json",
      }),
    );

    expect(() => decoder.push("data: \n\n")).toThrowError(
      expect.objectContaining<Partial<SummaryStreamProtocolError>>({
        code: "malformed_json",
      }),
    );

    expect(() => decoder.push(frame({ type: "future_event" }))).toThrowError(
      expect.objectContaining<Partial<SummaryStreamProtocolError>>({
        code: "unknown_event_variant",
      }),
    );

    expect(() => decoder.push(frame({ type: "content", text: 123 }))).toThrowError(
      expect.objectContaining<Partial<SummaryStreamProtocolError>>({
        code: "invalid_event",
      }),
    );

    expect(() =>
      decoder.push(
        frame({
          type: "full_transcript",
          segments: [],
          source: "whisper",
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<SummaryStreamProtocolError>>({
        code: "invalid_full_transcript",
      }),
    );
  });

  it("rejects timed Transcript entries without usable text or duration", () => {
    for (const segments of [
      [{ text: "", start: 0, duration: 1 }],
      [{ text: "   ", start: 0, duration: 1 }],
      [{ text: "legacy timing", start: 0, duration: 0 }],
    ]) {
      expect(
        SummarySseEventSchema.safeParse({
          type: "full_transcript",
          segments,
          source: "whisper",
        }).success,
      ).toBe(false);
    }
  });

  it("recovers a malformed full Transcript in wire order without hiding later events", () => {
    const decoder = new SummarySseStreamDecoder();
    const items = decoder.pushRecovering(
      frame({
        type: "full_transcript",
        segments: [{ text: "legacy timing", start: 0, duration: 0 }],
        source: "whisper",
      }) + frame({ type: "content", text: "Summary content" }),
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      kind: "error",
      error: { code: "invalid_full_transcript" },
    });
    expect(items[1]).toEqual({
      kind: "event",
      event: { type: "content", text: "Summary content" },
    });
  });

  it("validates events across chunk boundaries", () => {
    const decoder = new SummarySseStreamDecoder();
    const event = supportedEvents[5];
    const encoded = frame(event);
    const midpoint = Math.floor(encoded.length / 2);

    expect(decoder.push(encoded.slice(0, midpoint))).toEqual([]);
    expect(decoder.push(encoded.slice(midpoint))).toEqual([event]);
    expect(decoder.finish()).toEqual([]);
  });
});
