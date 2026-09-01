export const CHANNEL_HUB_VIDEO_QUERY_PARAM = "videoId" as const;

const SAFE_VIDEO_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/u;

function safeVideoId(value: unknown): value is string {
  return typeof value === "string" && SAFE_VIDEO_ID.test(value);
}

/**
 * Build a link for an already owner-scoped Video record. The Hub route still
 * verifies ownership server-side; this helper only constrains the URL shape.
 */
export function buildChannelHubVideoHref(videoId: unknown): string | null {
  if (!safeVideoId(videoId)) return null;
  return `/channel?${CHANNEL_HUB_VIDEO_QUERY_PARAM}=${encodeURIComponent(videoId)}`;
}

export function readChannelHubVideoFilter(
  searchParams: URLSearchParams | null | undefined,
): string | null {
  if (!searchParams) return null;
  const value = searchParams.get(CHANNEL_HUB_VIDEO_QUERY_PARAM);
  return safeVideoId(value) ? value : null;
}
