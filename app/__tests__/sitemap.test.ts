import { describe, it, expect } from "vitest";
import { buildSitemap } from "@/app/sitemap";
import type { BlogPost } from "@/lib/content/blog";
import type { FaqEntry } from "@/lib/content/faq";

// buildSitemap is the testable seam — sitemap() (default export) just
// reads from disk and forwards to buildSitemap.

function fixturePost(overrides: Partial<BlogPost>): BlogPost {
  return {
    title: "P",
    description: "Description that satisfies length validators.",
    slug: "p",
    publishedAt: "2026-01-01",
    updatedAt: "2026-01-01",
    author: "YouTubeAI Team",
    category: "comparisons",
    tags: [],
    faq: undefined,
    ogImage: undefined,
    draft: false,
    body: "",
    ...overrides,
  } as BlogPost;
}

function fixtureFaq(overrides: Partial<FaqEntry>): FaqEntry {
  return {
    question: "Is it free?",
    slug: "is-it-free",
    category: "pricing",
    order: 100,
    updatedAt: "2026-01-01",
    relatedBlogSlugs: [],
    draft: false,
    body: "yes.",
    answerText: "yes.",
    ...overrides,
  };
}

describe("buildSitemap", () => {
  it("includes all six static pages plus per-post entries", () => {
    const posts = [fixturePost({ slug: "a" }), fixturePost({ slug: "b" })];
    const result = buildSitemap(posts, []);
    const urls = result.map((e) => e.url);
    expect(urls).toContain("https://www.youtubeai.chat");
    expect(urls).toContain("https://www.youtubeai.chat/summary");
    expect(urls).toContain("https://www.youtubeai.chat/blog");
    expect(urls).toContain("https://www.youtubeai.chat/faq");
    expect(urls).toContain("https://www.youtubeai.chat/privacy");
    expect(urls).toContain("https://www.youtubeai.chat/terms");
    expect(urls).toContain("https://www.youtubeai.chat/blog/a");
    expect(urls).toContain("https://www.youtubeai.chat/blog/b");
  });

  it("works with empty posts and entries (still emits static pages)", () => {
    const result = buildSitemap([], []);
    const urls = result.map((e) => e.url);
    expect(urls).toContain("https://www.youtubeai.chat/blog");
    expect(urls).toContain("https://www.youtubeai.chat/faq");
    expect(result.find((e) => e.url.includes("/blog/"))).toBeUndefined();
  });

  it("emits Date objects for lastModified (ISO datetime, not bare YYYY-MM-DD)", () => {
    const result = buildSitemap([fixturePost({ slug: "a" })], []);
    for (const entry of result) {
      expect(entry.lastModified).toBeInstanceOf(Date);
    }
  });

  it("/blog listing lastmod tracks the freshest post (when newer than baseline)", () => {
    // Pick dates LATER than the LAST_MOD baseline (2026-04-28) so the
    // freshest-wins branch is the one being exercised.
    const posts = [
      fixturePost({ slug: "old", updatedAt: "2025-01-01" }),
      fixturePost({ slug: "new", updatedAt: "2026-06-15" }),
      fixturePost({ slug: "mid", updatedAt: "2025-12-01" }),
    ];
    const result = buildSitemap(posts, []);
    const blogListing = result.find(
      (e) => e.url === "https://www.youtubeai.chat/blog",
    );
    expect(blogListing).toBeDefined();
    const lm = blogListing!.lastModified as Date;
    expect(lm.toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });

  it("/blog listing lastmod respects the LAST_MOD baseline when posts are older", () => {
    const posts = [fixturePost({ slug: "ancient", updatedAt: "2020-01-01" })];
    const result = buildSitemap(posts, []);
    const blogListing = result.find(
      (e) => e.url === "https://www.youtubeai.chat/blog",
    )!;
    const lm = blogListing.lastModified as Date;
    expect(lm.toISOString()).toBe("2026-04-28T00:00:00.000Z");
  });

  it("/faq lastmod tracks the freshest entry (when newer than baseline)", () => {
    const entries = [
      fixtureFaq({ slug: "a", updatedAt: "2025-01-01" }),
      fixtureFaq({ slug: "b", updatedAt: "2026-06-10" }),
    ];
    const result = buildSitemap([], entries);
    const faqListing = result.find(
      (e) => e.url === "https://www.youtubeai.chat/faq",
    )!;
    const lm = faqListing.lastModified as Date;
    expect(lm.toISOString()).toBe("2026-06-10T00:00:00.000Z");
  });

  it("each post entry uses its own updatedAt, not a global", () => {
    const posts = [
      fixturePost({ slug: "a", updatedAt: "2026-01-15" }),
      fixturePost({ slug: "b", updatedAt: "2026-04-15" }),
    ];
    const result = buildSitemap(posts, []);
    const a = result.find(
      (e) => e.url === "https://www.youtubeai.chat/blog/a",
    )!;
    const b = result.find(
      (e) => e.url === "https://www.youtubeai.chat/blog/b",
    )!;
    expect((a.lastModified as Date).toISOString()).toBe(
      "2026-01-15T00:00:00.000Z",
    );
    expect((b.lastModified as Date).toISOString()).toBe(
      "2026-04-15T00:00:00.000Z",
    );
  });

  it("does NOT include FAQ entries as individual URLs (single /faq page only)", () => {
    const entries = [fixtureFaq({ slug: "is-it-free" })];
    const result = buildSitemap([], entries);
    const urls = result.map((e) => e.url);
    expect(urls).not.toContain("https://www.youtubeai.chat/faq/is-it-free");
  });
});
