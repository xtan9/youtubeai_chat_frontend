import { describe, it, expect } from "vitest";

// `opengraph-image.tsx` route handlers rely on Next.js's file convention:
// the route is only wired into OG/Twitter meta when the module exports
// `size`, `contentType`, and a default function (plus an optional `alt`).
// A refactor that strips one of those silently downgrades the OG output
// to whatever the layout falls back to. These tests pin the contract.
//
// We deliberately do NOT call the default export here — `next/og`
// ImageResponse pulls in Edge-runtime-only WASM that fails to load under
// the Vitest node environment. The end-to-end render is exercised by
// build (Next typechecks every opengraph-image route) and by the dev
// SSR check we run before merging. What we lock in here is the shape.

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
      const mod = await import(/* @vite-ignore */ path);
      expect(mod.size).toEqual(EXPECTED_SIZE);
      expect(mod.contentType).toBe(EXPECTED_CONTENT_TYPE);
      expect(typeof mod.alt).toBe("string");
      expect(mod.alt.length).toBeGreaterThan(0);
      expect(typeof mod.default).toBe("function");
    });
  }
});
