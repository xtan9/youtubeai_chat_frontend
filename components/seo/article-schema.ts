import type { BlogPost } from "@/lib/content/blog";

const SITE_URL = "https://www.youtubeai.chat";

// Posts with category "tutorials" emit HowTo if the body has numbered
// steps. For everything else we emit BlogPosting (a subtype of Article)
// — that's the right schema for opinion/explainer/comparison content
// and what answer engines look for.
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
