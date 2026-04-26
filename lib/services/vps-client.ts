import { z } from "zod";
import type { TranscriptSegment } from "./summarize-cache";
import { TranscriptSegmentSchema } from "@/lib/types";

// During the rollout window the schema accepts either shape:
// - new VPS emits `segments` (canonical) plus `transcript` (back-compat
//   for an old frontend deployment that hasn't picked up segments yet).
// - old VPS emits only `transcript`. Below we synthesize a single
//   un-clickable segment from it so this frontend keeps working during
//   the deploy crossover.
// Drop the `transcript`-only branch once the service rollout is done.
//
// `.min(1)` on segments rules out the "VPS bug returns empty arrays"
// failure mode — an empty-segments response is a real bug, not a
// back-compat shape, and it should fail loud through the route's catch
// instead of generating a useless empty-prompt LLM call downstream.
const TranscribeResponseSchema = z
  .object({
    segments: z.array(TranscriptSegmentSchema).min(1).optional(),
    transcript: z.string().optional(),
    language: z.string(),
    source: z.literal("whisper"),
  })
  .refine((data) => data.segments !== undefined || data.transcript !== undefined, {
    message: "either `segments` or `transcript` is required",
  });

export type TranscribeResult = {
  readonly segments: readonly TranscriptSegment[];
  readonly language: string;
  readonly source: "whisper";
};

// Vercel's route budget is 300s; leave ~60s headroom for the post-transcribe
// work on the same request (LLM streaming p99 ≈ 30s, cache write + SSE
// teardown a few seconds, plus slack for the oembed round-trip). If Vercel
// maxDuration is raised above 300s, bump this proportionally.
const DEFAULT_VPS_TIMEOUT_MS = 240_000;

export function buildTranscribeUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/transcribe`;
}

export async function transcribeViaVps(
  youtubeUrl: string,
  signal?: AbortSignal,
  lang?: string
): Promise<TranscribeResult> {
  const vpsBaseUrl = process.env.VPS_API_URL?.trim();
  const vpsApiKey = process.env.VPS_API_KEY?.trim();

  if (!vpsBaseUrl || !vpsApiKey) {
    throw new Error("VPS_API_URL and VPS_API_KEY must be configured");
  }

  const timeoutMs = Number(process.env.VPS_TIMEOUT_MS) || DEFAULT_VPS_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  // Spread `lang` in only when provided — the VPS zod schema rejects
  // `{ lang: undefined }` fields and a literal `null` body field. Back-
  // compat: callers that don't pass lang see the exact same request body
  // as before.
  const body: Record<string, unknown> = { youtube_url: youtubeUrl };
  if (lang) body.lang = lang;

  const response = await fetch(buildTranscribeUrl(vpsBaseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${vpsApiKey}`,
    },
    body: JSON.stringify(body),
    signal: combinedSignal,
  });

  if (!response.ok) {
    // Mirror caption-extractor's body-read safety: preserve the status
    // even if `text()` rejects (chunked-transfer break, malformed
    // content-encoding). Without the catch a body-read failure swallows
    // the original status and surfaces as a generic "TypeError: failed
    // to fetch body" — costs an hour in postmortem.
    const text = await response.text().catch(() => "");
    throw new Error(`VPS transcription failed (${response.status}): ${text}`);
  }

  const raw: unknown = await response.json();
  const parsed = TranscribeResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `VPS transcription returned unexpected shape: ${parsed.error.message}`
    );
  }
  // Prefer the new `segments` field; fall through to deriving a single
  // segment from the legacy `transcript` string for the rollout window.
  // The schema's refine() guarantees one of the two is present.
  let segments: readonly TranscriptSegment[];
  if (parsed.data.segments && parsed.data.segments.length > 0) {
    segments = parsed.data.segments;
  } else if (parsed.data.transcript) {
    // Hot path during the deploy crossover: log once with a stable errorId
    // so the cleanup PR has a signal the legacy branch is no longer hit
    // before the alias is dropped.
    console.warn("[vps-client] VPS_LEGACY_TRANSCRIPT_FALLBACK", {
      errorId: "VPS_LEGACY_TRANSCRIPT_FALLBACK",
    });
    segments = [
      { text: parsed.data.transcript, start: 0, duration: 0 },
    ];
  } else {
    throw new Error("VPS transcription returned no segments");
  }
  return {
    segments,
    language: parsed.data.language,
    source: parsed.data.source,
  };
}
