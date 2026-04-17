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

export type CaptionSource = Extract<
  TranscriptSource,
  "manual_captions" | "auto_captions"
>;

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

// youtube-transcript-plus doesn't publish a typed "isGenerated" flag on each
// segment, but most responses expose a `kind` (e.g. "asr") on either the
// segment or the containing track. We look for any of the known indicators
// and fall back to "auto_captions" — the conservative default that matches
// YouTube's default caption behavior for uploader-less videos.
function classifySource(
  segments: readonly TranscriptSegment[],
  result: TranscriptResult
): CaptionSource {
  const maybeAuto =
    (segments[0] as { kind?: string; isGenerated?: boolean })?.kind === "asr" ||
    (segments[0] as { isGenerated?: boolean })?.isGenerated === true ||
    (result as unknown as { trackKind?: string })?.trackKind === "asr";
  const maybeManual =
    (segments[0] as { kind?: string; isGenerated?: boolean })?.kind ===
      "standard" ||
    (segments[0] as { isGenerated?: boolean })?.isGenerated === false;
  if (maybeAuto) return "auto_captions";
  if (maybeManual) return "manual_captions";
  return "auto_captions";
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
      console.error("[caption-extractor] unexpected fetch failure", {
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
    source: classifySource(segments, result),
    language: pickLocale(segments),
    title: videoDetails?.title ?? "",
    channelName: videoDetails?.author ?? "",
  };
}
