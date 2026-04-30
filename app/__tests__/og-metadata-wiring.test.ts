import { describe, it, expect, vi } from "vitest";

// `app/layout.tsx` calls `Geist({ subsets: ["latin"], display: "swap" })` at
// module scope. That call is normally rewritten by Next's SWC transform at
// build time and only runs in a Webpack/Turbopack pipeline; under Vitest
// the module loads as plain JS and Geist isn't a function. Stub it as an
// identity factory returning the className shape the layout consumes.
vi.mock("next/font/google", () => ({
  Geist: () => ({ className: "test-font", style: { fontFamily: "test" } }),
}));

// Locks in the "metadata.openGraph.images must be undefined" invariant
// that lets the per-route `opengraph-image.tsx` file convention fire.
// Per Next.js, metadata.openGraph.images takes precedence over the file
// convention; if a future commit sets `images` here, every per-route
// generated card silently stops shipping. The comment in app/layout.tsx
// explains why; this test makes the invariant fail loudly.
describe("app/layout metadata", () => {
  it("does not set openGraph.images or twitter.images at the root", async () => {
    const { metadata } = await import("@/app/layout");
    expect(metadata.openGraph?.images).toBeUndefined();
    expect(metadata.twitter && "images" in metadata.twitter
      ? metadata.twitter.images
      : undefined).toBeUndefined();
  });
});

// Locks in the "only override images when frontmatter ships ogImage"
// invariant for blog posts. A regression that always sets `images`
// silently disables the dynamic per-post card.
describe("app/blog/[slug] generateMetadata", () => {
  it("omits openGraph.images and twitter.images when the post has no ogImage", async () => {
    const { generateMetadata } = await import("@/app/blog/[slug]/page");
    const blog = await import("@/lib/content/blog");
    // Find a post without an explicit ogImage. All current fixtures
    // happen to omit it; assert that and pick the first.
    const posts = blog.loadAllBlogPosts();
    const post = posts.find((p) => !p.ogImage);
    if (!post) {
      // If a future fixture adds ogImage to every post, this test stops
      // covering the no-override path — surface the gap loudly.
      throw new Error(
        "no fixture without ogImage — add one or split this test",
      );
    }

    const meta = await generateMetadata({
      params: Promise.resolve({ slug: post.slug }),
    });

    expect(meta.openGraph && "images" in meta.openGraph
      ? meta.openGraph.images
      : undefined).toBeUndefined();
    expect(meta.twitter && "images" in meta.twitter
      ? meta.twitter.images
      : undefined).toBeUndefined();
  });

  it("forwards post.ogImage to both openGraph.images and twitter.images when present", async () => {
    // No live fixture currently sets ogImage, so we spy on loadBlogPost
    // and synthesize one. Keeps the test independent of fixture churn.
    const blog = await import("@/lib/content/blog");
    const real = blog.loadBlogPost;
    const stub = {
      ...(real(blog.loadAllBlogSlugs()[0]) as NonNullable<
        ReturnType<typeof real>
      >),
      ogImage: "https://example.test/custom-og.png",
    };
    // Vitest auto-restores after the test, so this monkey-patch is local.
    const spy = vi.spyOn(blog, "loadBlogPost").mockReturnValue(stub);
    try {
      const { generateMetadata } = await import("@/app/blog/[slug]/page");
      const meta = await generateMetadata({
        params: Promise.resolve({ slug: stub.slug }),
      });
      expect(meta.openGraph?.images).toEqual([stub.ogImage]);
      expect(meta.twitter && "images" in meta.twitter
        ? meta.twitter.images
        : undefined).toEqual([stub.ogImage]);
    } finally {
      spy.mockRestore();
    }
  });
});

