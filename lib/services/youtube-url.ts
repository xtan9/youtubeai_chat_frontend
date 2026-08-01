const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS: ReadonlySet<string> = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

export function extractVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !YOUTUBE_HOSTS.has(hostname)
  ) {
    return null;
  }

  const pathParts = parsed.pathname.split("/").filter(Boolean);
  let videoId: string | null = null;
  if (hostname === "youtu.be") {
    videoId = pathParts.length === 1 ? pathParts[0] : null;
  } else if (parsed.pathname === "/watch") {
    videoId = parsed.searchParams.get("v");
  } else if (
    pathParts.length === 2 &&
    ["embed", "live", "shorts", "v"].includes(pathParts[0])
  ) {
    videoId = pathParts[1];
  }

  return videoId && VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
}

/**
 * Normalize a raw video ID or a supported YouTube URL to the URL shape
 * required by the authenticated transcription service.
 */
export function normalizeYouTubeVideoInput(input: string): string | null {
  const value = input.trim();
  if (VIDEO_ID_PATTERN.test(value)) {
    return `https://www.youtube.com/watch?v=${value}`;
  }
  return extractVideoId(value) ? value : null;
}
