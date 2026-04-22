import { z } from "zod";
import type { PromptLocale, TranscriptSource } from "./summarize-cache";
import { extractVideoId } from "./youtube-url";

export { extractVideoId };

// The VPS response doesn't distinguish ASR from uploader-provided tracks, so
// everything through this path is honestly labelled auto_captions.
export type CaptionSource = Extract<TranscriptSource, "auto_captions">;

export interface CaptionResult {
  readonly transcript: string;
  readonly source: CaptionSource;
  readonly language: PromptLocale;
  readonly title: string;
  readonly channelName: string;
}

// Matches the VPS /captions 200 contract. VPS returns `string | null` for
// title/channelName when video metadata is unavailable; normalize to "" here
// so the route's existing string contract holds.
const CaptionsResponseSchema = z.object({
  transcript: z.string(),
  source: z.literal("auto_captions"),
  language: z.enum(["en", "zh"]),
  title: z.string().nullable(),
  channelName: z.string().nullable(),
});

// Captions path is fast — a slow VPS response here is a signal to fall back
// to Whisper, not to keep waiting. Keep well under the route's 300s budget.
const DEFAULT_VPS_CAPTIONS_TIMEOUT_MS = 30_000;

export function buildCaptionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/captions`;
}

// Returns null for all "no usable captions" outcomes (including unexpected
// VPS failures) so the caller silently falls back to Whisper. Unexpected
// failures are logged with a stable errorId so a systematic outage is
// visible in alerts instead of silently burning the Whisper compute bill.
export async function extractCaptions(
  youtubeUrl: string,
  signal?: AbortSignal
): Promise<CaptionResult | null> {
  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) return null;

  const vpsBaseUrl = process.env.VPS_API_URL?.trim();
  const vpsApiKey = process.env.VPS_API_KEY?.trim();
  if (!vpsBaseUrl || !vpsApiKey) {
    throw new Error("VPS_API_URL and VPS_API_KEY must be configured");
  }

  const timeoutMs =
    Number(process.env.VPS_CAPTIONS_TIMEOUT_MS) ||
    DEFAULT_VPS_CAPTIONS_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(buildCaptionsUrl(vpsBaseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${vpsApiKey}`,
      },
      body: JSON.stringify({ youtube_url: youtubeUrl }),
      signal: combinedSignal,
    });
  } catch (err) {
    return reportUnexpectedFailure(videoId, signal, {
      errorClass: err instanceof Error ? err.constructor.name : typeof err,
      err,
    });
  }

  // 404 is the stable "no captions available" contract — fall through to
  // Whisper without logging.
  if (response.status === 404) return null;

  if (!response.ok) {
    // Mirror of llm-client's body-read safety: preserve the status as the
    // primary error signal but surface body-read failures via a stable
    // errorId so "empty body" and "body read crashed" are distinguishable
    // in postmortem rather than collapsed into the same silent "".
    const text = await response.text().catch((err) => {
      console.error("[captions] failed to read error response body", {
        errorId: "CAPTIONS_GATEWAY_BODY_READ_FAILED",
        status: response.status,
        err,
      });
      return "";
    });
    return reportUnexpectedFailure(videoId, signal, {
      status: response.status,
      body: text.slice(0, 200),
    });
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (err) {
    return reportUnexpectedFailure(videoId, signal, {
      errorClass: "JsonParse",
      err,
    });
  }

  const parsed = CaptionsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return reportUnexpectedFailure(videoId, signal, {
      errorClass: "SchemaMismatch",
      issues: parsed.error.issues,
    });
  }

  const data = parsed.data;
  if (!data.transcript) return null;

  return {
    transcript: data.transcript,
    source: data.source,
    language: data.language,
    title: data.title ?? "",
    channelName: data.channelName ?? "",
  };
}

// Alertable: unexpected failures here silently fall back to paid Whisper
// transcription. A systematic VPS outage can burn the compute bill with no
// other signal — errorId is the stable alert key.
//
// Suppresses the log when the caller's own signal aborted: a user closing
// the tab mid-request will typically surface as a fetch/JSON-parse failure
// on whichever await was in flight, and classifying those as unexpected
// would fire a false alert on every client disconnect.
function reportUnexpectedFailure(
  videoId: string,
  signal: AbortSignal | undefined,
  extra: Record<string, unknown>
): null {
  if (signal?.aborted) return null;
  console.error("[caption-extractor] CAPTION_UNEXPECTED_FAILURE", {
    errorId: "CAPTION_UNEXPECTED_FAILURE",
    videoId,
    ...extra,
  });
  return null;
}
