import {
  fetchTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptInvalidVideoIdError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptVideoUnavailableError,
  type TranscriptResult,
  type TranscriptSegment,
} from "youtube-transcript-plus";
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

// Errors that mean "no usable captions" — a normal fallback, not an alert.
const EXPECTED_NO_CAPTIONS_ERRORS = [
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptVideoUnavailableError,
  YoutubeTranscriptInvalidVideoIdError,
] as const;

function isExpectedNoCaptions(err: unknown): boolean {
  return EXPECTED_NO_CAPTIONS_ERRORS.some((cls) => err instanceof cls);
}

function pickLocale(segments: readonly TranscriptSegment[]): PromptLocale {
  const lang = segments[0]?.lang ?? "";
  return lang.toLowerCase().startsWith("zh") ? "zh" : "en";
}

// Every silent fallback here costs a paid transcription, so unexpected errors
// are logged with context.
export async function extractCaptions(
  youtubeUrl: string
): Promise<CaptionResult | null> {
  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) return null;

  let result: TranscriptResult;
  try {
    const response = await fetchTranscript(videoId, { videoDetails: true });
    result = response as TranscriptResult;
  } catch (err) {
    if (!isExpectedNoCaptions(err)) {
      // Alertable: unexpected failures here silently fall back to paid
      // Whisper transcription. A systematic library outage can burn the
      // VPS budget with no other signal — errorId is the stable alert key.
      console.error("[caption-extractor] CAPTION_UNEXPECTED_FAILURE", {
        errorId: "CAPTION_UNEXPECTED_FAILURE",
        videoId,
        errorClass: err instanceof Error ? err.constructor.name : typeof err,
        err,
      });
    }
    return null;
  }

  const { segments, videoDetails } = result;
  if (!segments || segments.length === 0) return null;

  const transcript = segments
    .map((s) => s.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!transcript) return null;

  return {
    transcript,
    source: "auto_captions",
    language: pickLocale(segments),
    title: videoDetails?.title ?? "",
    channelName: videoDetails?.author ?? "",
  };
}
