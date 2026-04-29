import type { BlogPost } from "@/lib/content/blog";

const SITE_URL = "https://www.youtubeai.chat";

// BlogPosting (a subtype of Article) — the right schema for the post
// page across all categories. Tutorials/comparisons/news/workflows all
// share this builder; per-category specialization (e.g. emitting HowTo
// for tutorials with numbered steps) is a deliberate non-feature for
// now to keep the schema graph predictable.
export function buildBlogPostingSchema(post: BlogPost) {
  const url = `${SITE_URL}/blog/${post.slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    url,
    datePublished: `${post.publishedAt}T00:00:00Z`,
    dateModified: `${post.updatedAt}T00:00:00Z`,
    author: {
      "@type": "Organization",
      name: post.author,
      url: SITE_URL,
    },
    publisher: {
      "@type": "Organization",
      name: "YouTubeAI",
      url: SITE_URL,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/youtube-summary-demo.png`,
      },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    image: post.ogImage
      ? `${SITE_URL}${post.ogImage.startsWith("/") ? "" : "/"}${post.ogImage}`
      : `${SITE_URL}/youtube-summary-demo.png`,
    keywords: post.tags.join(", "),
    articleSection: post.category,
  };
}
