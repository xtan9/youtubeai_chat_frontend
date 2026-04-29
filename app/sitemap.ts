import { MetadataRoute } from "next";
import { loadAllBlogPosts } from "@/lib/content/blog";
import { loadAllFaqEntries } from "@/lib/content/faq";

const baseUrl = "https://www.youtubeai.chat";

// Static lastmod baseline. Bumping this is a deliberate signal to crawlers
// that content changed; `new Date()` per request would tell Google
// "everything changed every crawl," which trains it to ignore lastmod.
const LAST_MOD = "2026-04-28";

export default function sitemap(): MetadataRoute.Sitemap {
  const blogPosts = loadAllBlogPosts();
  const faqEntries = loadAllFaqEntries();

  // Use the most recently updated blog post / faq entry to drive the
  // listing-page lastmod, so the listing's freshness reflects its
  // contents without faking date changes on individual rows.
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
      lastModified: LAST_MOD,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/summary`,
      lastModified: LAST_MOD,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/blog`,
      lastModified: newestBlog,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/faq`,
      lastModified: newestFaq,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: LAST_MOD,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: LAST_MOD,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  const blogEntries: MetadataRoute.Sitemap = blogPosts.map((post) => ({
    url: `${baseUrl}/blog/${post.slug}`,
    lastModified: post.updatedAt,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [...staticEntries, ...blogEntries];
}
