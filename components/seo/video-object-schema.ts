import type { BlogPost } from "@/lib/content/blog";

const SITE_URL = "https://www.youtubeai.chat";

// Wraps the YouTube hero video referenced by a post in a VideoObject
// schema attributed to OUR page (description, embedUrl, etc. tied to
// the blog post). This is what lets the post outrank generic "summary
// of <video>" queries — Google treats it as our commentary on the
// video, not duplicate content.
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

function extractYouTubeId(url: string): string | null {
  // Handle youtube.com/watch?v=, youtu.be/, /shorts/, /embed/.
  const m =
    url.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
    url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ||
    url.match(/\/shorts\/([A-Za-z0-9_-]{11})/) ||
    url.match(/\/embed\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function secondsToIso8601Duration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return (
    "PT" +
    (h > 0 ? `${h}H` : "") +
    (m > 0 ? `${m}M` : "") +
    (s > 0 || (h === 0 && m === 0) ? `${s}S` : "")
  );
}
