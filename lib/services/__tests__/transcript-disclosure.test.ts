import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import {
  getTranscriptDisclosureBySummaryId,
  getVideoTranscriptDisclosure,
  TranscriptDisclosureError,
} from "../transcript-disclosure";

interface ChainScript {
  table: string;
  response: { data: unknown; error: unknown };
  expect?: (calls: ChainCall[]) => void;
}

interface ChainCall {
  method: string;
  args: unknown[];
}

function buildClient(scripts: ChainScript[]): SupabaseClient {
  let index = 0;
  const from = vi.fn((table: string) => {
    const script = scripts[index++];
    if (!script) throw new Error(`unexpected from('${table}') call`);
    if (script.table !== table) {
      throw new Error(`expected from('${script.table}'), got '${table}'`);
    }

    const calls: ChainCall[] = [];
    const proxy: Record<string, unknown> = {};
    const chain = (method: string) => (...args: unknown[]) => {
      calls.push({ method, args });
      return proxy;
    };
    proxy.select = chain("select");
    proxy.eq = chain("eq");
    proxy.order = chain("order");
    proxy.limit = chain("limit");
    proxy.maybeSingle = chain("maybeSingle");
    proxy.then = (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown,
    ) => {
      script.expect?.(calls);
      return Promise.resolve(script.response).then(resolve, reject);
    };
    return proxy;
  });

  return { from } as unknown as SupabaseClient;
}

const SUMMARY_ID = "summary-1";
const VIDEO_ID = "video-1";

describe("transcript disclosure service", () => {
  it("selects the newest summary for a video and includes auxiliary metadata", async () => {
    const client = buildClient([
      {
        table: "summaries",
        response: {
          data: {
            id: SUMMARY_ID,
            video_id: VIDEO_ID,
            transcript: "newest transcript",
            transcript_source: "whisper",
            created_at: "2026-04-05T00:00:00Z",
          },
          error: null,
        },
        expect: (calls) => {
          expect(calls).toContainEqual({
            method: "order",
            args: ["created_at", { ascending: false }],
          });
          expect(calls).toContainEqual({ method: "limit", args: [1] });
        },
      },
      {
        table: "videos",
        response: {
          data: {
            title: "Video title",
            channel_name: "Channel",
            language: "en",
          },
          error: null,
        },
      },
    ]);

    await expect(getVideoTranscriptDisclosure(client, VIDEO_ID)).resolves.toEqual({
      summaryId: SUMMARY_ID,
      videoId: VIDEO_ID,
      transcript: "newest transcript",
      source: "whisper",
      videoTitle: "Video title",
      channelName: "Channel",
      language: "en",
      videoFetchFailed: false,
      createdAt: "2026-04-05T00:00:00Z",
    });
  });

  it("validates source vocabulary and reports missing video summaries", async () => {
    const invalidSourceClient = buildClient([
      {
        table: "summaries",
        response: {
          data: {
            id: SUMMARY_ID,
            video_id: VIDEO_ID,
            transcript: "raw",
            transcript_source: "future_source",
            created_at: "2026-04-05T00:00:00Z",
          },
          error: null,
        },
      },
    ]);
    await expect(
      getVideoTranscriptDisclosure(invalidSourceClient, VIDEO_ID),
    ).rejects.toBeInstanceOf(TranscriptDisclosureError);

    const missingClient = buildClient([
      { table: "summaries", response: { data: null, error: null } },
    ]);
    await expect(
      getVideoTranscriptDisclosure(missingClient, VIDEO_ID),
    ).resolves.toBeNull();
  });

  it("keeps transcript disclosure available when auxiliary video metadata fails", async () => {
    const client = buildClient([
      {
        table: "summaries",
        response: {
          data: {
            id: SUMMARY_ID,
            video_id: VIDEO_ID,
            transcript: "raw",
            transcript_source: "auto_captions",
            created_at: "2026-04-05T00:00:00Z",
          },
          error: null,
        },
      },
      {
        table: "videos",
        response: { data: null, error: { message: "metadata down" } },
      },
    ]);

    await expect(getVideoTranscriptDisclosure(client, VIDEO_ID)).resolves.toMatchObject({
      transcript: "raw",
      videoTitle: null,
      channelName: null,
      language: null,
      videoFetchFailed: true,
    });
  });

  it("returns the full summary disclosure by summary id and skips a missing video id", async () => {
    const client = buildClient([
      {
        table: "summaries",
        response: {
          data: {
            id: SUMMARY_ID,
            video_id: null,
            transcript: "raw transcript",
            summary: "summary text",
            transcript_source: "manual_captions",
            model: "model-1",
            processing_time_seconds: 12.5,
            created_at: "2026-04-05T00:00:00Z",
          },
          error: null,
        },
        expect: (calls) => {
          expect(calls).toContainEqual({
            method: "select",
            args: [
              "id, video_id, transcript, summary, transcript_source, model, processing_time_seconds, created_at",
            ],
          });
        },
      },
    ]);

    await expect(
      getTranscriptDisclosureBySummaryId(client, SUMMARY_ID),
    ).resolves.toEqual({
      summaryId: SUMMARY_ID,
      transcript: "raw transcript",
      summary: "summary text",
      videoTitle: null,
      channelName: null,
      language: null,
      videoFetchFailed: false,
      source: "manual_captions",
      model: "model-1",
      processingTimeSeconds: 12.5,
      createdAt: "2026-04-05T00:00:00Z",
    });
  });

  it("surfaces primary summary read failures", async () => {
    const client = buildClient([
      {
        table: "summaries",
        response: { data: null, error: { message: "summary down" } },
      },
    ]);

    await expect(
      getTranscriptDisclosureBySummaryId(client, SUMMARY_ID),
    ).rejects.toBeInstanceOf(TranscriptDisclosureError);
  });
});
