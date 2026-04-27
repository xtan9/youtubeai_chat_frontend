import { MetadataRoute } from "next";

const baseUrl = "https://www.youtubeai.chat";

// Static lastmod baseline. Bumping this is a deliberate signal to crawlers
// that content changed; `new Date()` per request would tell Google
// "everything changed every crawl," which trains it to ignore lastmod.
const LAST_MOD = "2026-04-27";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
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
}
