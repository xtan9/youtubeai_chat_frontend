const VIDEO_ID_PATTERNS: readonly RegExp[] = [
  /(?:youtube\.com\/watch\?v=)([^#&?]{11})/,
  /(?:youtu\.be\/)([^#&?]{11})/,
  /(?:youtube\.com\/embed\/)([^#&?]{11})/,
  /(?:youtube\.com\/v\/)([^#&?]{11})/,
  /(?:youtube\.com\/shorts\/)([^#&?]{11})/,
];

export function extractVideoId(url: string): string | null {
  for (const pattern of VIDEO_ID_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}
