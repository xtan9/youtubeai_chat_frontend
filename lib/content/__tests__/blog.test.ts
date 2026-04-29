import { describe, it, expect } from "vitest";
import {
  BlogPostFrontmatterSchema,
  loadAllBlogPosts,
  loadBlogPost,
  loadAllBlogSlugs,
  loadRelatedBlogPosts,
  scoreRelatedPosts,
  type BlogPost,
} from "@/lib/content/blog";

const VALID_HERO = {
  url: "https://www.youtube.com/watch?v=cdiD-9MMpb0",
  title: "Test Video",
};

const baseFields = {
  title: "Example Post",
  description: "A description that satisfies the 20-200 char range. yes.",
  publishedAt: "2026-04-28",
};

describe("BlogPostFrontmatterSchema (discriminated union)", () => {
  it("accepts a comparisons post without heroVideo", () => {
    const result = BlogPostFrontmatterSchema.parse({
      ...baseFields,
      category: "comparisons",
    });
    expect(result.category).toBe("comparisons");
    expect(result.author).toBe("YouTubeAI Team"); // default
    expect(result.tags).toEqual([]);
    expect(result.draft).toBe(false);
  });

  it("accepts a workflow post WITH heroVideo", () => {
    const result = BlogPostFrontmatterSchema.parse({
      ...baseFields,
      category: "workflows",
      heroVideo: VALID_HERO,
    });
    expect(result.category).toBe("workflows");
    if (result.category === "workflows") {
      // Type-narrowed: heroVideo is required, no `?` access needed.
      expect(result.heroVideo.url).toBe(VALID_HERO.url);
    }
  });

  it("REJECTS a workflow post WITHOUT heroVideo (anti-slop guard)", () => {
    expect(() =>
      BlogPostFrontmatterSchema.parse({
        ...baseFields,
        category: "workflows",
      }),
    ).toThrow();
  });

  it("rejects a heroVideo with non-YouTube URL", () => {
    expect(() =>
      BlogPostFrontmatterSchema.parse({
        ...baseFields,
        category: "workflows",
        heroVideo: { url: "https://vimeo.com/12345", title: "x" },
      }),
    ).toThrow(/youtube/i);
  });

  it("accepts youtu.be short links in heroVideo", () => {
    expect(() =>
      BlogPostFrontmatterSchema.parse({
        ...baseFields,
        category: "workflows",
        heroVideo: {
          url: "https://youtu.be/cdiD-9MMpb0",
          title: "x",
        },
      }),
    ).not.toThrow();
  });

  it("rejects too-short description", () => {
    expect(() =>
      BlogPostFrontmatterSchema.parse({
        ...baseFields,
        description: "short",
        category: "comparisons",
      }),
    ).toThrow();
  });

  it("rejects bad slug shape", () => {
    expect(() =>
      BlogPostFrontmatterSchema.parse({
        ...baseFields,
        category: "comparisons",
        slug: "Bad Slug!",
      }),
    ).toThrow();
  });

  it("rejects bad date shape", () => {
    expect(() =>
      BlogPostFrontmatterSchema.parse({
        ...baseFields,
        category: "comparisons",
        publishedAt: "April 28 2026",
      }),
    ).toThrow();
  });

  it("rejects unknown category", () => {
    expect(() =>
      BlogPostFrontmatterSchema.parse({ ...baseFields, category: "rambling" }),
    ).toThrow();
  });
});

describe("loadAllBlogPosts (against real seed content)", () => {
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

  it("falls back updatedAt to publishedAt when not set", () => {
    for (const p of posts) {
      expect(p.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("workflow posts have heroVideo (now type-enforced, this is a sanity check)", () => {
    const workflows = posts.filter((p) => p.category === "workflows");
    for (const p of workflows) {
      // TypeScript narrows this to required, but verify at runtime too.
      expect(p.heroVideo).toBeDefined();
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

// Pure-function tests for the scoring algorithm — no disk, no seed dependency.
describe("scoreRelatedPosts (pure)", () => {
  function fixturePost(overrides: Partial<BlogPost>): BlogPost {
    return {
      title: "X",
      description: "A description that satisfies length requirements nicely.",
      slug: overrides.slug ?? "x",
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

  const source = fixturePost({
    slug: "source",
    category: "workflows",
    tags: ["podcasts", "long-form"],
    heroVideo: VALID_HERO,
    publishedAt: "2026-04-01",
    updatedAt: "2026-04-01",
  } as Partial<BlogPost>);

  const sameTagsAndCategory = fixturePost({
    slug: "high-overlap",
    category: "workflows",
    tags: ["podcasts", "long-form"],
    heroVideo: VALID_HERO,
    publishedAt: "2026-02-01",
    updatedAt: "2026-02-01",
  } as Partial<BlogPost>);

  const sameCategoryNoTagOverlap = fixturePost({
    slug: "category-only",
    category: "workflows",
    tags: ["meetings"],
    heroVideo: VALID_HERO,
    publishedAt: "2026-03-01",
    updatedAt: "2026-03-01",
  } as Partial<BlogPost>);

  const differentEverything = fixturePost({
    slug: "no-overlap",
    category: "tutorials",
    tags: ["math"],
    publishedAt: "2026-03-15",
    updatedAt: "2026-03-15",
  });

  const candidates = [
    sameTagsAndCategory,
    sameCategoryNoTagOverlap,
    differentEverything,
  ];

  it("excludes the source post", () => {
    const result = scoreRelatedPosts(source, [...candidates, source]);
    expect(result.find((p) => p.slug === source.slug)).toBeUndefined();
  });

  it("ranks tag-overlap higher than category-only", () => {
    const result = scoreRelatedPosts(source, candidates);
    expect(result[0].slug).toBe(sameTagsAndCategory.slug);
  });

  it("ranks no-overlap last", () => {
    const result = scoreRelatedPosts(source, candidates);
    expect(result[result.length - 1].slug).toBe(differentEverything.slug);
  });

  it("breaks score ties by recency (newer first)", () => {
    const a = fixturePost({
      slug: "older",
      category: "comparisons",
      tags: ["x"],
      publishedAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });
    const b = fixturePost({
      slug: "newer",
      category: "comparisons",
      tags: ["x"],
      publishedAt: "2026-03-01",
      updatedAt: "2026-03-01",
    });
    const src = fixturePost({
      slug: "src",
      category: "comparisons",
      tags: ["x"],
      publishedAt: "2026-04-01",
      updatedAt: "2026-04-01",
    });
    const result = scoreRelatedPosts(src, [a, b]);
    expect(result.map((p) => p.slug)).toEqual(["newer", "older"]);
  });

  it("respects the limit", () => {
    const result = scoreRelatedPosts(source, candidates, 1);
    expect(result.length).toBe(1);
  });

  it("handles empty candidate list", () => {
    expect(scoreRelatedPosts(source, [])).toEqual([]);
  });
});

// Sanity check that the on-disk loader still wires through to the
// scoring fn (without re-asserting the scoring contract — that's
// covered by the pure tests above).
describe("loadRelatedBlogPosts (on-disk)", () => {
  it("never returns the source post", () => {
    const all = loadAllBlogPosts();
    if (all.length < 2) return;
    const related = loadRelatedBlogPosts(all[0]);
    expect(related.find((p) => p.slug === all[0].slug)).toBeUndefined();
  });
});
