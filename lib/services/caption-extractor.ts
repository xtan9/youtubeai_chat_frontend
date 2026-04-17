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
import type { Language, TranscriptSource } from "./summarize-cache";

export interface CaptionResult {
  readonly transcript: string;
  readonly source: Extract<TranscriptSource, "auto_captions">;
  readonly language: Language;
  readonly title: string;
  readonly channelName: string;
}

const VIDEO_ID_PATTERNS: readonly RegExp[] = [
  /(?:youtube\.com\/watch\?v=)([^#&?]{11})/,
  /(?:youtu\.be\/)([^#&?]{11})/,
  /(?:youtube\.com\/embed\/)([^#&?]{11})/,
  /(?:youtube\.com\/v\/)([^#&?]{11})/,
];

export function extractVideoId(url: string): string | null {
  for (const pattern of VIDEO_ID_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// These errors mean "this video has no usable captions" — a normal fallback
// signal, not something to shout about.
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

function pickLanguage(segments: readonly TranscriptSegment[]): Language {
  const lang = segments[0]?.lang ?? "";
  return lang.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/**
 * Fetch YouTube captions and video metadata in a single Innertube call.
 * Returns null when the video has no usable captions (expected — falls through
 * to the Whisper path). Unexpected failures are logged with context; every
 * silent fallback costs a paid transcription so visibility matters.
 */
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
    source: "auto_captions",
    language: pickLanguage(segments),
    title: videoDetails?.title ?? "",
    channelName: videoDetails?.author ?? "",
  };
}
