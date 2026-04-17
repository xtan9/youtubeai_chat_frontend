const ID = "([A-Za-z0-9_-]{11})";
const HOST = "(?:www\\.|m\\.|music\\.)?youtube\\.com";

const VIDEO_ID_PATTERNS: readonly RegExp[] = [
  new RegExp(`${HOST}/watch\\?v=${ID}`),
  new RegExp(`${HOST}/embed/${ID}`),
  new RegExp(`${HOST}/v/${ID}`),
  new RegExp(`${HOST}/shorts/${ID}`),
  new RegExp(`youtu\\.be/${ID}`),
];

export function extractVideoId(url: string): string | null {
  for (const pattern of VIDEO_ID_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}
