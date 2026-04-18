import { z } from "zod";
import type { PromptLocale, TranscriptSource } from "./summarize-cache";
import { extractVideoId } from "./youtube-url";

export { extractVideoId };

// Library doesn't expose whether a track is ASR vs uploader-provided, so
// everything through this path is honestly labelled auto_captions.
export type CaptionSource = Extract<TranscriptSource, "auto_captions">;

export interface CaptionResult {
  readonly transcript: string;
  readonly source: CaptionSource;
  readonly language: PromptLocale;
  readonly title: string;
  readonly channelName: string;
}

// Matches the VPS /captions 200 contract. title/channelName arrive as
// `string | null` from the upstream library's optional videoDetails;
// normalize to "" here so the route's existing string contract holds.
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

  const vpsBaseUrl = process.env.VPS_API_URL;
  const vpsApiKey = process.env.VPS_API_KEY;
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
    // Caller abort is an intentional teardown — the route already handles
    // it via isCallerAbort(request.signal) and must not see a noisy log.
    if (signal?.aborted) return null;
    logUnexpectedFailure(videoId, {
      errorClass: err instanceof Error ? err.constructor.name : typeof err,
      err,
    });
    return null;
  }

  // 404 is the stable "no captions available" contract — fall through to
  // Whisper without logging, matching the previous library's expected-error
  // branch.
  if (response.status === 404) return null;

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    logUnexpectedFailure(videoId, {
      status: response.status,
      body: text.slice(0, 200),
    });
    return null;
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (err) {
    logUnexpectedFailure(videoId, {
      errorClass: "JsonParse",
      err,
    });
    return null;
  }

  const parsed = CaptionsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    logUnexpectedFailure(videoId, {
      errorClass: "SchemaMismatch",
      issues: parsed.error.issues,
    });
    return null;
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
function logUnexpectedFailure(
  videoId: string,
  extra: Record<string, unknown>
): void {
  console.error("[caption-extractor] CAPTION_UNEXPECTED_FAILURE", {
    errorId: "CAPTION_UNEXPECTED_FAILURE",
    videoId,
    ...extra,
  });
}
