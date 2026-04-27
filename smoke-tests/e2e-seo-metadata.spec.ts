import { test, expect } from "@playwright/test";

// Pin the SEO metadata contract so the canonical-bug class doesn't silently
// regress: search engines just demote, there's no runtime signal. Defaults
// to local dev (`pnpm dev`); set BASE_URL to point at a deployed env.
const BASE_URL = (
  process.env.BASE_URL?.trim() || "http://localhost:3000"
).replace(/\/$/, "");

type SeoSnapshot = {
  canonical: string | null;
  robots: string | null;
  h1Count: number;
  ogImage: string | null;
  twitterImage: string | null;
  jsonLdTypes: string[];
};

async function snapshot(page: import("@playwright/test").Page, path: string) {
  await page.goto(`${BASE_URL}${path}`);
  return page.evaluate((): SeoSnapshot => {
    const jsonLd = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    )
      .map((s) => {
        try {
          return JSON.parse(s.textContent ?? "")["@type"];
        } catch {
          return null;
        }
      })
      .filter((t): t is string => typeof t === "string");
    return {
      canonical:
        document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
          ?.href ?? null,
      robots:
        document.querySelector<HTMLMetaElement>('meta[name="robots"]')
          ?.content ?? null,
      h1Count: document.querySelectorAll("h1").length,
      ogImage:
        document.querySelector<HTMLMetaElement>('meta[property="og:image"]')
          ?.content ?? null,
      twitterImage:
        document.querySelector<HTMLMetaElement>('meta[name="twitter:image"]')
          ?.content ?? null,
      jsonLdTypes: jsonLd,
    };
  });
}

test.describe("SEO metadata contract", () => {
  test("home renders five inline JSON-LD blocks and absolute og/twitter images", async ({
    page,
  }) => {
    const snap = await snapshot(page, "/");
    expect(snap.canonical).toMatch(/\/$/);
    expect(snap.h1Count).toBe(1);
    expect(snap.ogImage).toMatch(/^https?:\/\/.+\.(png|jpg|jpeg|webp)$/i);
    expect(snap.twitterImage).toMatch(/^https?:\/\/.+\.(png|jpg|jpeg|webp)$/i);
    expect(snap.jsonLdTypes).toEqual(
      expect.arrayContaining([
        "WebApplication",
        "Service",
        "Organization",
        "FAQPage",
        "HowTo",
      ]),
    );
  });

  test("every same-origin <link> in <head> resolves 2xx (catches broken icons / manifest)", async ({
    page,
    request,
  }) => {
    // Headless Chromium doesn't actually fetch `<link rel="icon">` or
    // `<link rel="manifest">` resources from the parsed HTML, so a
    // `page.on("response")` listener never sees their 404s. Instead, parse
    // the head for every link href and probe each via `request.get`. This
    // is the assertion that would have caught (a) the 12 broken size-
    // specific favicons declared in `metadata.icons` against an empty
    // /public, and (b) /manifest.json being redirected to /auth/login by
    // unauthenticated middleware.
    await page.goto(`${BASE_URL}/`);
    const sameHost = new URL(BASE_URL).host;
    const linkHrefs = await page.$$eval("head link[href]", (els) =>
      (els as HTMLLinkElement[]).map((l) => ({
        rel: l.rel,
        href: l.href,
      })),
    );
    const sameOrigin = linkHrefs.filter((l) => {
      try {
        return new URL(l.href).host === sameHost;
      } catch {
        return false;
      }
    });
    expect(sameOrigin.length).toBeGreaterThan(0);

    const failures: string[] = [];
    for (const { rel, href } of sameOrigin) {
      // Follow redirects so a 3xx → 2xx chain still passes; a 3xx that
      // ends in HTML (the manifest-to-login bug) lands as 200 but with
      // wrong content-type, which we check separately for known types.
      const res = await request.get(href);
      if (res.status() >= 400) {
        failures.push(`${res.status()} [${rel}] ${href}`);
      } else if (rel === "manifest") {
        const ct = res.headers()["content-type"] ?? "";
        if (!ct.includes("json")) {
          failures.push(
            `manifest content-type "${ct}" (likely redirected to HTML) ${href}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test("bare /summary is indexable with a self-canonical and exactly one h1", async ({
    page,
  }) => {
    const snap = await snapshot(page, "/summary");
    expect(snap.canonical).toMatch(/\/summary$/);
    expect(snap.h1Count).toBe(1);
    expect(snap.robots ?? "").not.toMatch(/noindex/i);
  });

  test("/summary?url=... results view is noindex (dynamic user content)", async ({
    page,
  }) => {
    const snap = await snapshot(
      page,
      "/summary?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Ddummy",
    );
    expect(snap.robots ?? "").toMatch(/noindex/i);
  });

  for (const path of ["/terms", "/privacy", "/auth/login", "/auth/sign-up"]) {
    test(`${path} self-canonicalizes and is indexable`, async ({ page }) => {
      const snap = await snapshot(page, path);
      expect(snap.canonical).toContain(path);
      expect(snap.robots ?? "").not.toMatch(/noindex/i);
    });
  }

  for (const path of ["/summary", "/terms", "/privacy"]) {
    test(`${path} emits BreadcrumbList JSON-LD`, async ({ page }) => {
      const snap = await snapshot(page, path);
      expect(snap.jsonLdTypes).toContain("BreadcrumbList");
    });
  }

  for (const path of ["/terms", "/privacy"]) {
    test(`${path} emits WebPage JSON-LD`, async ({ page }) => {
      const snap = await snapshot(page, path);
      expect(snap.jsonLdTypes).toContain("WebPage");
    });
  }

  for (const path of [
    "/auth/forgot-password",
    "/auth/update-password",
    "/auth/sign-up-success",
    "/auth/error",
  ]) {
    test(`${path} is noindex,nofollow (flow-internal)`, async ({ page }) => {
      const snap = await snapshot(page, path);
      expect(snap.robots ?? "").toMatch(/noindex/i);
      expect(snap.robots ?? "").toMatch(/nofollow/i);
    });
  }
});
