import { MetadataRoute } from "next";
import { loadAllBlogPosts, type BlogPost } from "@/lib/content/blog";
import { loadAllFaqEntries, type FaqEntry } from "@/lib/content/faq";

const baseUrl = "https://www.youtubeai.chat";

// Static lastmod baseline. Bumping this is a deliberate signal to crawlers
// that content changed; `new Date()` per request would tell Google
// "everything changed every crawl," which trains it to ignore lastmod.
const LAST_MOD = "2026-04-28";

// Date-string YYYY-MM-DD → Date at UTC midnight. Sitemap consumers
// expect ISO datetime; bare YYYY-MM-DD is technically valid but Search
// Console occasionally flags it.
function isoDate(d: string): Date {
  return new Date(`${d}T00:00:00Z`);
}

export function buildSitemap(
  blogPosts: BlogPost[],
  faqEntries: FaqEntry[],
): MetadataRoute.Sitemap {
  // The listing-page lastmod tracks the freshest item it contains, so
  // crawlers get an accurate freshness signal without us faking dates
  // on individual rows.
  const newestBlog = blogPosts.reduce(
    (acc, p) => (p.updatedAt > acc ? p.updatedAt : acc),
    LAST_MOD,
  );
  const newestFaq = faqEntries.reduce(
    (acc, e) => (e.updatedAt > acc ? e.updatedAt : acc),
    LAST_MOD,
  );

  const staticEntries: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: isoDate(LAST_MOD),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/summary`,
      lastModified: isoDate(LAST_MOD),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/blog`,
      lastModified: isoDate(newestBlog),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/faq`,
      lastModified: isoDate(newestFaq),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: isoDate(LAST_MOD),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: isoDate(LAST_MOD),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  const blogEntries: MetadataRoute.Sitemap = blogPosts.map((post) => ({
    url: `${baseUrl}/blog/${post.slug}`,
    lastModified: isoDate(post.updatedAt),
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [...staticEntries, ...blogEntries];
}

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemap(loadAllBlogPosts(), loadAllFaqEntries());
}
