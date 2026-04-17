import { fetchTranscript } from "youtube-transcript-plus";

export interface CaptionResult {
  transcript: string;
  source: "manual_captions" | "auto_captions";
  language: string;
}

/**
 * Extract YouTube video ID from various URL formats.
 */
export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([^#&?]{11})/,
    /(?:youtu\.be\/)([^#&?]{11})/,
    /(?:youtube\.com\/embed\/)([^#&?]{11})/,
    /(?:youtube\.com\/v\/)([^#&?]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Extract captions from a YouTube video.
 * Tries to fetch transcript using youtube-transcript-plus.
 * Returns null if no captions are available.
 */
export async function extractCaptions(
  youtubeUrl: string
): Promise<CaptionResult | null> {
  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) return null;

  try {
    const segments = await fetchTranscript(videoId, { lang: "en" });

    if (!segments || segments.length === 0) return null;

    const transcript = segments
      .map((segment) => segment.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!transcript) return null;

    return {
      transcript,
      source: "auto_captions",
      language: "en",
    };
  } catch {
    return null;
  }
}
