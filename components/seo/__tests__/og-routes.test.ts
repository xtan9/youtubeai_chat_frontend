import { describe, it, expect, vi } from "vitest";

// `opengraph-image.tsx` route handlers rely on Next.js's file convention:
// the route is only wired into OG/Twitter meta when the module exports
// `size`, `contentType`, and a default function (plus an optional `alt`).
// A refactor that strips one of those silently downgrades the OG output
// to whatever the layout falls back to. These tests pin the contract.
//
// We can't render the actual ImageResponse under Vitest — `next/og` pulls
// in Edge-runtime-only WASM that fails to load in jsdom. Instead we mock
// `next/og` so each `buildOgCard` / route default returns the JSX it
// would have rendered, and we walk that tree to assert the user-visible
// strings flow through. End-to-end render is exercised by `next build`
// (compiles every opengraph-image route) and by the dev SSR PNG check we
// run before merging.

// `next/og` is invoked via `new ImageResponse(...)` — we need the mock to
// be a constructor, not a plain factory, or the call site throws "is not
// a constructor". A bare class with one captured prop is enough; the real
// PNG render is exercised by `next build` and dev SSR.
vi.mock("next/og", () => ({
  ImageResponse: class {
    __jsx: unknown;
    constructor(jsx: unknown) {
      this.__jsx = jsx;
    }
  },
}));

// Recursively flatten visible text from a JSX subtree (React.createElement
// nodes have `props.children`). Keeps tests resilient to layout-tweak
// refactors — we only assert the strings users see.
function jsxText(node: unknown): string {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(jsxText).join(" ");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props: { children?: unknown } }).props;
    return jsxText(props.children);
  }
  return "";
}

const EXPECTED_SIZE = { width: 1200, height: 630 };
const EXPECTED_CONTENT_TYPE = "image/png";

const routes = [
  { name: "blog index", path: "@/app/blog/opengraph-image" },
  { name: "blog post", path: "@/app/blog/[slug]/opengraph-image" },
  { name: "FAQ", path: "@/app/faq/opengraph-image" },
  { name: "summary", path: "@/app/summary/opengraph-image" },
];

describe("opengraph-image route metadata exports", () => {
  for (const { name, path } of routes) {
    it(`${name} exports size + contentType + alt + default`, async () => {
      const mod = await import(path);
      expect(mod.size).toEqual(EXPECTED_SIZE);
      expect(mod.contentType).toBe(EXPECTED_CONTENT_TYPE);
      expect(typeof mod.alt).toBe("string");
      expect(mod.alt.length).toBeGreaterThan(0);
      expect(typeof mod.default).toBe("function");
    });
  }
});

describe("buildOgCard", () => {
  it("forwards title, subtitle, and eyebrow into the rendered tree", async () => {
    const { buildOgCard } = await import("@/components/seo/og-card");
    const result = buildOgCard({
      title: "TITLE-MARKER",
      subtitle: "SUBTITLE-MARKER",
      eyebrow: "EYEBROW-MARKER",
    }) as { __jsx: unknown };
    const text = jsxText(result.__jsx);
    expect(text).toContain("TITLE-MARKER");
    expect(text).toContain("SUBTITLE-MARKER");
    expect(text).toContain("EYEBROW-MARKER");
    // Wordmark is always rendered.
    expect(text).toContain("youtubeai.chat");
  });

  it("omits subtitle and eyebrow when not provided", async () => {
    const { buildOgCard } = await import("@/components/seo/og-card");
    const result = buildOgCard({ title: "ONLY-TITLE" }) as { __jsx: unknown };
    const text = jsxText(result.__jsx);
    expect(text).toContain("ONLY-TITLE");
    expect(text).toContain("youtubeai.chat");
    // Eyebrow placeholders shouldn't sneak in when the prop is absent.
    expect(text).not.toContain("undefined");
  });
});

describe("blog [slug] opengraph-image route", () => {
  it("renders the post's title, description, and category for a known slug", async () => {
    const route = await import("@/app/blog/[slug]/opengraph-image");
    const blog = await import("@/lib/content/blog");
    const slugs = blog.loadAllBlogSlugs();
    expect(slugs.length).toBeGreaterThan(0);
    const slug = slugs[0];
    const post = blog.loadBlogPost(slug);
    if (!post) throw new Error(`fixture missing: ${slug}`);

    const result = (await route.default({
      params: Promise.resolve({ slug }),
    })) as { __jsx: unknown };
    const text = jsxText(result.__jsx);

    expect(text).toContain(post.title);
    expect(text).toContain(post.description);
    expect(text).toContain(post.category);
  });

  it("falls back to the blog-index card when the slug is unknown", async () => {
    const route = await import("@/app/blog/[slug]/opengraph-image");
    const result = (await route.default({
      params: Promise.resolve({ slug: "__does_not_exist__" }),
    })) as { __jsx: unknown };
    const text = jsxText(result.__jsx);

    // Fallback card uses the blog-index copy — pinning that string here
    // would couple this test to the static blog-index file. Instead just
    // assert we got *some* card with the wordmark rather than a throw.
    expect(text).toContain("youtubeai.chat");
    expect(text).toContain("Workflows");
  });
});
