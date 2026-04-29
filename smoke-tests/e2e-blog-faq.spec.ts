import { test, expect } from "@playwright/test";

// Pin the /blog and /faq surfaces against regression. Mirrors the shape
// of e2e-seo-metadata.spec.ts (canonical, JSON-LD type set, single h1)
// because the blog/faq routes are first and foremost an SEO/AEO surface
// — that's the whole point of shipping them.
const BASE_URL = (
  process.env.BASE_URL?.trim() || "http://localhost:3000"
).replace(/\/$/, "");

type Snapshot = {
  canonical: string | null;
  h1Count: number;
  h1Text: string | null;
  jsonLdTypes: string[];
  jsonLdBlocks: object[];
};

async function snapshot(page: import("@playwright/test").Page, path: string) {
  const response = await page.goto(`${BASE_URL}${path}`);
  return {
    status: response?.status() ?? 0,
    snap: await page.evaluate((): Snapshot => {
      const blocks = Array.from(
        document.querySelectorAll('script[type="application/ld+json"]'),
      )
        .map((s) => {
          try {
            return JSON.parse(s.textContent ?? "");
          } catch {
            return null;
          }
        })
        .filter((b): b is object => b !== null);
      return {
        canonical:
          document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
            ?.href ?? null,
        h1Count: document.querySelectorAll("h1").length,
        h1Text:
          document.querySelector<HTMLHeadingElement>("h1")?.textContent ?? null,
        jsonLdTypes: blocks
          .map((b) => (b as { "@type"?: string })["@type"])
          .filter((t): t is string => typeof t === "string"),
        jsonLdBlocks: blocks,
      };
    }),
  };
}

test.describe("/blog listing", () => {
  test("renders with one h1, self-canonical, and Blog + BreadcrumbList JSON-LD", async ({
    page,
  }) => {
    const { status, snap } = await snapshot(page, "/blog");
    expect(status).toBe(200);
    expect(snap.canonical).toMatch(/\/blog$/);
    expect(snap.h1Count).toBe(1);
    expect(snap.h1Text).toMatch(/blog/i);
    expect(snap.jsonLdTypes).toEqual(
      expect.arrayContaining(["Blog", "BreadcrumbList"]),
    );
  });

  test("links to at least one published post", async ({ page }) => {
    await page.goto(`${BASE_URL}/blog`);
    const postLinks = page.locator('a[href^="/blog/"]:not([href="/blog"])');
    expect(await postLinks.count()).toBeGreaterThan(0);
  });
});

test.describe("/blog/[slug] post page", () => {
  test("a seed post renders with full SEO surface", async ({ page }) => {
    const path = "/blog/summarize-long-podcast";
    const { status, snap } = await snapshot(page, path);
    expect(status).toBe(200);
    expect(snap.canonical).toContain(path);
    expect(snap.h1Count).toBe(1);
    expect(snap.jsonLdTypes).toEqual(
      expect.arrayContaining([
        "BlogPosting",
        "BreadcrumbList",
        "VideoObject",
        "FAQPage",
      ]),
    );
  });

  test("VideoObject schema attributes the video to OUR page (mainEntityOfPage)", async ({
    page,
  }) => {
    const { snap } = await snapshot(page, "/blog/summarize-long-podcast");
    const videoObj = snap.jsonLdBlocks.find(
      (b) => (b as { "@type"?: string })["@type"] === "VideoObject",
    ) as { mainEntityOfPage?: { "@id"?: string } } | undefined;
    expect(videoObj?.mainEntityOfPage?.["@id"]).toContain(
      "/blog/summarize-long-podcast",
    );
  });

  test("CTA card links to /summary?url=<heroVideo>", async ({ page }) => {
    await page.goto(`${BASE_URL}/blog/summarize-long-podcast`);
    const cta = page.locator('a[href^="/summary?url="]').first();
    await expect(cta).toBeVisible();
    const href = await cta.getAttribute("href");
    expect(href).toContain("youtube.com");
  });

  test("unknown slug returns 404", async ({ page }) => {
    const { status } = await snapshot(page, "/blog/this-slug-does-not-exist");
    expect(status).toBe(404);
  });
});

test.describe("/faq page", () => {
  test("renders with one h1, self-canonical, and FAQPage + BreadcrumbList JSON-LD", async ({
    page,
  }) => {
    const { status, snap } = await snapshot(page, "/faq");
    expect(status).toBe(200);
    expect(snap.canonical).toMatch(/\/faq$/);
    expect(snap.h1Count).toBe(1);
    expect(snap.jsonLdTypes).toEqual(
      expect.arrayContaining(["FAQPage", "BreadcrumbList"]),
    );
  });

  test("FAQPage JSON-LD includes at least the seeded entries with non-empty plain-text answers", async ({
    page,
  }) => {
    const { snap } = await snapshot(page, "/faq");
    const faqBlock = snap.jsonLdBlocks.find(
      (b) => (b as { "@type"?: string })["@type"] === "FAQPage",
    ) as
      | {
          mainEntity?: {
            name: string;
            acceptedAnswer: { text: string };
          }[];
        }
      | undefined;
    expect(faqBlock).toBeDefined();
    expect(faqBlock!.mainEntity!.length).toBeGreaterThanOrEqual(7);
    for (const entry of faqBlock!.mainEntity!) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.acceptedAnswer.text.length).toBeGreaterThan(20);
      // No raw markdown leaked into the schema text.
      expect(entry.acceptedAnswer.text).not.toMatch(/```|^#|\*\*/m);
    }
  });

  test("category sections all render", async ({ page }) => {
    await page.goto(`${BASE_URL}/faq`);
    // We seed at least one entry in pricing, accuracy, privacy,
    // features, troubleshooting (5 distinct sections).
    const h2s = await page.locator("h2").allTextContents();
    expect(h2s.some((t) => /pricing/i.test(t))).toBe(true);
    expect(h2s.some((t) => /accuracy/i.test(t))).toBe(true);
    expect(h2s.some((t) => /privacy/i.test(t))).toBe(true);
    expect(h2s.some((t) => /features/i.test(t))).toBe(true);
    expect(h2s.some((t) => /troubleshooting/i.test(t))).toBe(true);
  });
});

test.describe("nav integration", () => {
  test("homepage exposes Blog and FAQ links to crawlers", async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    // Use literal href predicates rather than getByRole to keep the
    // assertion robust against duplicate links (header + footer + body).
    expect(await page.locator('a[href="/blog"]').count()).toBeGreaterThan(0);
    expect(await page.locator('a[href="/faq"]').count()).toBeGreaterThan(0);
  });

  test("header nav (Blog, FAQ) sits next to the brand on the left, not centered", async ({
    page,
  }) => {
    // Three flex children with `justify-between` push the middle child
    // (the nav) to the visual center. Pin the layout so a future
    // refactor that drops the brand+nav grouping wrapper surfaces as a
    // test failure rather than a "why is Blog floating in the middle"
    // bug report.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE_URL}/`);
    const brand = await page
      .locator('header a[href="/"]')
      .first()
      .boundingBox();
    const blog = await page
      .locator('header a[href="/blog"]')
      .first()
      .boundingBox();
    expect(brand, "brand link must be visible in header").not.toBeNull();
    expect(blog, "Blog link must be visible in header").not.toBeNull();
    // Blog must sit in the left half of the viewport.
    expect(blog!.x).toBeLessThan(640);
    // And within 200px of the brand's right edge, so it's clearly
    // grouped — not coincidentally left of center.
    expect(blog!.x - (brand!.x + brand!.width)).toBeLessThan(200);
  });

  test("sitemap.xml lists /blog, /faq, and every published post", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/sitemap.xml`);
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("https://www.youtubeai.chat/blog");
    expect(xml).toContain("https://www.youtubeai.chat/faq");
    expect(xml).toContain(
      "https://www.youtubeai.chat/blog/summarize-long-podcast",
    );
    expect(xml).toContain(
      "https://www.youtubeai.chat/blog/extract-tutorial-takeaways",
    );
  });
});
