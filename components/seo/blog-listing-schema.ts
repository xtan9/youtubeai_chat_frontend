import type { BlogPost } from "@/lib/content/blog";

const SITE_URL = "https://www.youtubeai.chat";

// CollectionPage + Blog for the /blog listing. Helps search engines
// understand the page is a hub and surface individual posts as
// sitelinks under brand queries.
export function buildBlogListingSchema(posts: BlogPost[]) {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${SITE_URL}/blog`,
    url: `${SITE_URL}/blog`,
    name: "YouTubeAI Blog",
    description:
      "Workflows, comparisons, and tutorials for getting more out of YouTube videos with AI.",
    publisher: {
      "@type": "Organization",
      name: "YouTubeAI",
      url: SITE_URL,
    },
    blogPost: posts.map((p) => ({
      "@type": "BlogPosting",
      headline: p.title,
      url: `${SITE_URL}/blog/${p.slug}`,
      datePublished: `${p.publishedAt}T00:00:00Z`,
      dateModified: `${p.updatedAt}T00:00:00Z`,
      description: p.description,
    })),
  };
}
