import type { BlogPost } from "@/lib/content/blog";
import { extractYouTubeId } from "@/lib/youtube-url";

const SITE_URL = "https://www.youtubeai.chat";

// Attributes the hero video to OUR page via mainEntityOfPage so Google
// treats the schema as our commentary on the video, not duplicate
// content — this is what lets a post outrank generic "summary of
// <video>" queries.
//
// Returns null if the post has no heroVideo.
export function buildVideoObjectSchema(post: BlogPost) {
  if (!post.heroVideo) return null;
  const v = post.heroVideo;
  const watchId = extractYouTubeId(v.url);
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: v.title,
    description: post.description,
    contentUrl: v.url,
    embedUrl: watchId ? `https://www.youtube.com/embed/${watchId}` : v.url,
    thumbnailUrl: watchId
      ? [
          `https://i.ytimg.com/vi/${watchId}/maxresdefault.jpg`,
          `https://i.ytimg.com/vi/${watchId}/hqdefault.jpg`,
        ]
      : undefined,
    uploadDate: `${post.publishedAt}T00:00:00Z`,
    duration: v.durationSec
      ? secondsToIso8601Duration(v.durationSec)
      : undefined,
    publisher: {
      "@type": "Organization",
      name: v.channel ?? "YouTube",
    },
    isAccessibleForFree: true,
    inLanguage: "en",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${SITE_URL}/blog/${post.slug}`,
    },
  };
}

function secondsToIso8601Duration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  // ISO 8601 PT requires at least one component — emit PT0S for exact zero.
  const wantSeconds = s > 0 || (h === 0 && m === 0);
  return (
    "PT" +
    (h > 0 ? `${h}H` : "") +
    (m > 0 ? `${m}M` : "") +
    (wantSeconds ? `${s}S` : "")
  );
}
