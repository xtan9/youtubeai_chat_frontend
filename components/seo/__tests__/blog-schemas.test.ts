import { describe, it, expect } from "vitest";
import { buildBlogPostingSchema } from "@/components/seo/article-schema";
import { buildBlogListingSchema } from "@/components/seo/blog-listing-schema";
import { buildVideoObjectSchema } from "@/components/seo/video-object-schema";
import { buildFaqPageSchema } from "@/components/seo/faq-page-schema";
import type { BlogPost } from "@/lib/content/blog";
import type { FaqEntry } from "@/lib/content/faq";

const fixturePost: BlogPost = {
  title: "Sample Workflow Post",
  description:
    "A description that satisfies the 20-200 char range nicely for fixtures.",
  slug: "sample-workflow-post",
  publishedAt: "2026-04-28",
  updatedAt: "2026-04-28",
  author: "YouTubeAI Team",
  category: "workflows",
  tags: ["podcasts", "tutorials"],
  heroVideo: {
    url: "https://www.youtube.com/watch?v=cdiD-9MMpb0",
    title: "Some Real Video",
    channel: "Some Channel",
    durationSec: 7200,
  },
  faq: [],
  draft: false,
  body: "Some markdown body.",
};

describe("buildBlogPostingSchema", () => {
  const schema = buildBlogPostingSchema(fixturePost);

  it("declares BlogPosting at top level", () => {
    expect(schema["@context"]).toBe("https://schema.org");
    expect(schema["@type"]).toBe("BlogPosting");
  });

  it("uses absolute canonical URL", () => {
    expect(schema.url).toBe(
      "https://www.youtubeai.chat/blog/sample-workflow-post",
    );
    expect(schema.mainEntityOfPage["@id"]).toBe(schema.url);
  });

  it("emits ISO datetime for publish + modified", () => {
    expect(schema.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
    expect(schema.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
  });

  it("falls back to default OG image if none provided", () => {
    expect(schema.image).toMatch(/youtube-summary-demo\.png$/);
  });

  it("uses provided ogImage with leading slash", () => {
    const post = { ...fixturePost, ogImage: "/og/custom.png" };
    expect(buildBlogPostingSchema(post).image).toBe(
      "https://www.youtubeai.chat/og/custom.png",
    );
  });

  it("uses provided ogImage without leading slash (compensates)", () => {
    const post = { ...fixturePost, ogImage: "og/custom.png" };
    expect(buildBlogPostingSchema(post).image).toBe(
      "https://www.youtubeai.chat/og/custom.png",
    );
  });

  it("serializes without throwing", () => {
    expect(() => JSON.stringify(schema)).not.toThrow();
  });
});

describe("buildBlogListingSchema", () => {
  const schema = buildBlogListingSchema([fixturePost]);

  it("declares Blog at top level", () => {
    expect(schema["@type"]).toBe("Blog");
    expect(schema["@id"]).toBe("https://www.youtubeai.chat/blog");
  });

  it("emits one BlogPosting per source post", () => {
    expect(schema.blogPost).toHaveLength(1);
    expect(schema.blogPost[0]["@type"]).toBe("BlogPosting");
    expect(schema.blogPost[0].url).toBe(
      "https://www.youtubeai.chat/blog/sample-workflow-post",
    );
  });

  it("handles empty arrays", () => {
    const empty = buildBlogListingSchema([]);
    expect(empty.blogPost).toEqual([]);
  });
});

describe("buildVideoObjectSchema", () => {
  it("returns null for a tutorials post without heroVideo", () => {
    const noVideo: BlogPost = {
      ...fixturePost,
      category: "tutorials",
      heroVideo: undefined,
    };
    expect(buildVideoObjectSchema(noVideo)).toBeNull();
  });

  it("emits VideoObject with thumbnail URLs derived from the YouTube id", () => {
    const schema = buildVideoObjectSchema(fixturePost);
    expect(schema).not.toBeNull();
    expect(schema!["@type"]).toBe("VideoObject");
    expect(schema!.embedUrl).toBe(
      "https://www.youtube.com/embed/cdiD-9MMpb0",
    );
    expect(schema!.thumbnailUrl).toEqual([
      "https://i.ytimg.com/vi/cdiD-9MMpb0/maxresdefault.jpg",
      "https://i.ytimg.com/vi/cdiD-9MMpb0/hqdefault.jpg",
    ]);
  });

  it("emits ISO 8601 PT2H for an exact-hour video", () => {
    const schema = buildVideoObjectSchema(fixturePost);
    expect(schema!.duration).toBe("PT2H");
  });

  it("emits PT0S for sub-minute durations", () => {
    const post: BlogPost = {
      ...fixturePost,
      heroVideo: { ...fixturePost.heroVideo!, durationSec: 30 },
    };
    expect(buildVideoObjectSchema(post)!.duration).toBe("PT30S");
  });

  it("composes hours and minutes for an interview-length video", () => {
    const post: BlogPost = {
      ...fixturePost,
      heroVideo: { ...fixturePost.heroVideo!, durationSec: 3 * 3600 + 27 * 60 },
    };
    expect(buildVideoObjectSchema(post)!.duration).toBe("PT3H27M");
  });

  it("attributes the video to OUR page via mainEntityOfPage", () => {
    const schema = buildVideoObjectSchema(fixturePost);
    expect(schema!.mainEntityOfPage["@id"]).toBe(
      "https://www.youtubeai.chat/blog/sample-workflow-post",
    );
  });

  it("handles youtu.be short links", () => {
    const post: BlogPost = {
      ...fixturePost,
      heroVideo: {
        url: "https://youtu.be/aircAruvnKk",
        title: "x",
      },
    };
    const schema = buildVideoObjectSchema(post);
    expect(schema!.embedUrl).toBe("https://www.youtube.com/embed/aircAruvnKk");
  });

  it("handles /shorts/ links", () => {
    const post: BlogPost = {
      ...fixturePost,
      heroVideo: {
        url: "https://www.youtube.com/shorts/aircAruvnKk",
        title: "x",
      },
    };
    const schema = buildVideoObjectSchema(post);
    expect(schema!.embedUrl).toBe("https://www.youtube.com/embed/aircAruvnKk");
  });

  it("handles /embed/ links", () => {
    const post: BlogPost = {
      ...fixturePost,
      heroVideo: {
        url: "https://www.youtube.com/embed/aircAruvnKk",
        title: "x",
      },
    };
    const schema = buildVideoObjectSchema(post);
    expect(schema!.embedUrl).toBe("https://www.youtube.com/embed/aircAruvnKk");
  });

  it("omits duration when durationSec is not provided", () => {
    const post: BlogPost = {
      ...fixturePost,
      heroVideo: {
        url: fixturePost.heroVideo!.url,
        title: fixturePost.heroVideo!.title,
      },
    };
    expect(buildVideoObjectSchema(post)!.duration).toBeUndefined();
  });
});

describe("buildFaqPageSchema", () => {
  const fixture: FaqEntry = {
    question: "Test question?",
    slug: "test-q",
    category: "pricing",
    order: 1,
    updatedAt: "2026-04-28",
    relatedBlogSlugs: [],
    draft: false,
    body: "**Bold** answer.",
    answerText: "Bold answer.",
  };

  it("declares FAQPage at top level", () => {
    const schema = buildFaqPageSchema([fixture]);
    expect(schema["@type"]).toBe("FAQPage");
    expect(schema["@context"]).toBe("https://schema.org");
  });

  it("emits one mainEntity per source entry", () => {
    const schema = buildFaqPageSchema([fixture, { ...fixture, slug: "q2" }]);
    expect(schema.mainEntity).toHaveLength(2);
  });

  it("handles empty input array", () => {
    expect(buildFaqPageSchema([]).mainEntity).toEqual([]);
  });

  it("uses answerText (plain) not the markdown body in the JSON-LD", () => {
    const schema = buildFaqPageSchema([fixture]);
    expect(schema.mainEntity[0].acceptedAnswer.text).toBe("Bold answer.");
    expect(schema.mainEntity[0].acceptedAnswer.text).not.toMatch(/\*/);
  });

  it("each mainEntity is a Question wrapping an Answer", () => {
    const schema = buildFaqPageSchema([fixture]);
    expect(schema.mainEntity[0]["@type"]).toBe("Question");
    expect(schema.mainEntity[0].acceptedAnswer["@type"]).toBe("Answer");
  });
});
