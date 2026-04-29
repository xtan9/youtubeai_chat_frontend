import { describe, it, expect } from "vitest";
import {
  BlogPostFrontmatterSchema,
  loadAllBlogPosts,
  loadBlogPost,
  loadAllBlogSlugs,
  loadRelatedBlogPosts,
} from "@/lib/content/blog";

// These tests run against the real content/blog/ directory. They're
// effectively a contract check: every committed post must parse, and the
// loader's filtering/sorting/relation-scoring must behave consistently.
// If you add a new post and a test breaks, the post is what's wrong, not
// the test — fix the frontmatter.

describe("BlogPostFrontmatterSchema", () => {
  const validBase = {
    title: "Example Post",
    description: "A description that satisfies the 20-200 char range. yes.",
    publishedAt: "2026-04-28",
    category: "comparisons",
  };

  it("accepts minimal valid frontmatter", () => {
    const result = BlogPostFrontmatterSchema.parse(validBase);
    expect(result.title).toBe("Example Post");
    expect(result.author).toBe("YouTubeAI Team"); // default
    expect(result.tags).toEqual([]);
    expect(result.draft).toBe(false);
  });

  it("rejects too-short description", () => {
    expect(() =>
      BlogPostFrontmatterSchema.parse({ ...validBase, description: "short" }),
    ).toThrow();
  });

  it("rejects bad slug shape", () => {
    expect(() =>
      BlogPostFrontmatterSchema.parse({ ...validBase, slug: "Bad Slug!" }),
    ).toThrow();
  });

  it("rejects bad date shape", () => {
    expect(() =>
      BlogPostFrontmatterSchema.parse({
        ...validBase,
        publishedAt: "April 28 2026",
      }),
    ).toThrow();
  });

  it("rejects unknown category", () => {
    expect(() =>
      BlogPostFrontmatterSchema.parse({
        ...validBase,
        category: "rambling",
      }),
    ).toThrow();
  });

  it("accepts a workflow with heroVideo", () => {
    const r = BlogPostFrontmatterSchema.parse({
      ...validBase,
      category: "workflows",
      heroVideo: {
        url: "https://www.youtube.com/watch?v=cdiD-9MMpb0",
        title: "Test Video",
      },
    });
    expect(r.heroVideo?.url).toContain("youtube.com");
  });
});

describe("loadAllBlogPosts", () => {
  const posts = loadAllBlogPosts();

  it("loads at least the seed posts", () => {
    expect(posts.length).toBeGreaterThanOrEqual(2);
  });

  it("excludes drafts by default", () => {
    expect(posts.every((p) => p.draft === false)).toBe(true);
  });

  it("sorts newest first", () => {
    for (let i = 0; i < posts.length - 1; i++) {
      expect(posts[i].publishedAt >= posts[i + 1].publishedAt).toBe(true);
    }
  });

  it("derives a slug for every post", () => {
    for (const p of posts) {
      expect(p.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("workflow posts must have a heroVideo (anti-slop guard)", () => {
    const workflows = posts.filter((p) => p.category === "workflows");
    for (const p of workflows) {
      expect(p.heroVideo, `workflow post ${p.slug} missing heroVideo`).toBeDefined();
    }
  });

  it("falls back updatedAt to publishedAt when not set", () => {
    for (const p of posts) {
      expect(p.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("loadBlogPost", () => {
  it("returns a post by slug", () => {
    const slugs = loadAllBlogSlugs();
    expect(slugs.length).toBeGreaterThan(0);
    const post = loadBlogPost(slugs[0]);
    expect(post).not.toBeNull();
    expect(post?.slug).toBe(slugs[0]);
  });

  it("returns null for an unknown slug", () => {
    expect(loadBlogPost("does-not-exist-zzz")).toBeNull();
  });
});

describe("loadRelatedBlogPosts", () => {
  it("never returns the source post", () => {
    const all = loadAllBlogPosts();
    if (all.length < 2) return; // skip if seed only has 1 post
    const related = loadRelatedBlogPosts(all[0]);
    expect(related.find((p) => p.slug === all[0].slug)).toBeUndefined();
  });

  it("respects the limit", () => {
    const all = loadAllBlogPosts();
    if (all.length < 2) return;
    const related = loadRelatedBlogPosts(all[0], 1);
    expect(related.length).toBeLessThanOrEqual(1);
  });
});
