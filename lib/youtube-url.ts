// Pure helpers for YouTube URLs. Used by content validation (refusing
// non-YouTube hero videos at build time) and by the VideoObject schema
// builder (deriving embed + thumbnail URLs from a watch URL).
//
// We accept four shapes Google's video crawler treats as canonical:
// /watch?v=, youtu.be/, /shorts/, /embed/. An 11-character base64url id
// is the YouTube ID format that's been stable since 2008.

const YOUTUBE_ID_PATTERN =
  /(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/;

export function extractYouTubeId(url: string): string | null {
  const m = url.match(YOUTUBE_ID_PATTERN);
  return m ? m[1] : null;
}

export function isYouTubeUrl(url: string): boolean {
  return extractYouTubeId(url) !== null;
}
