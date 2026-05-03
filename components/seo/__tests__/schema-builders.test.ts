import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { buildHowToSchema } from "@/components/seo/howto-schema";
import { buildOrganizationSchema } from "@/components/seo/organization-schema";
import { buildBreadcrumbSchema } from "@/components/seo/breadcrumb-schema";
import { buildWebPageSchema } from "@/components/seo/webpage-schema";
import { buildWebApplicationSchema } from "@/components/seo/webapp-schema";

describe("buildHowToSchema", () => {
  const schema = buildHowToSchema();

  it("declares HowTo at the top level", () => {
    expect(schema["@context"]).toBe("https://schema.org");
    expect(schema["@type"]).toBe("HowTo");
    expect(schema.name).toMatch(/.+/);
    expect(schema.description).toMatch(/.+/);
  });

  it("emits 5 sequential HowToSteps with non-empty content", () => {
    expect(schema.step).toHaveLength(5);
    schema.step.forEach((s, i) => {
      expect(s["@type"]).toBe("HowToStep");
      expect(s.position).toBe(i + 1);
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.text.length).toBeGreaterThan(0);
    });
  });

  it("totalTime is an ISO-8601 duration", () => {
    expect(schema.totalTime).toMatch(/^PT\d+M$/);
  });

  it("serializes without throwing", () => {
    expect(() => JSON.stringify(schema)).not.toThrow();
  });
});

describe("buildOrganizationSchema", () => {
  const schema = buildOrganizationSchema();

  it("declares Organization aligned with the WebApplication brand", () => {
    expect(schema["@type"]).toBe("Organization");
    // Pin the brand name — must stay in lock-step with WebApplication.name
    // (asserted in the buildWebApplicationSchema block) so Google can
    // consolidate them into a single Knowledge Graph entity.
    expect(schema.name).toBe("YouTube AI Chat");
    expect(schema.alternateName).toBe("youtubeai.chat");
    expect(schema.description.length).toBeGreaterThan(0);
    expect(schema.url).toMatch(/^https:\/\/www\.youtubeai\.chat/);
    // logo must resolve to an absolute URL — Google ignores relative paths
    // here, and a missing logo means no Knowledge Panel mark.
    expect(schema.logo).toMatch(/^https:\/\/www\.youtubeai\.chat\/logo\.svg$/);
  });

  it("publishes a customer-support contactPoint with the business email", () => {
    expect(schema.contactPoint["@type"]).toBe("ContactPoint");
    expect(schema.contactPoint.contactType).toBe("customer support");
    expect(schema.contactPoint.email).toBe("contact@youtubeai.chat");
    expect(schema.contactPoint.availableLanguage).toEqual(["English"]);
  });

  // Pinning the URL string is not enough — a refactor that moves the
  // logo path (e.g. /brand/logo.svg) or renames the asset would still
  // pass the regex above while breaking Google's Knowledge Graph mark.
  // This guards the asset side of the contract.
  it("logo URL points at an asset that actually exists in /public", () => {
    const path = new URL(schema.logo).pathname;
    expect(existsSync(join(process.cwd(), "public", path))).toBe(true);
  });
});

describe("buildWebApplicationSchema", () => {
  const schema = buildWebApplicationSchema();

  it("declares WebApplication in the productivity category", () => {
    expect(schema["@context"]).toBe("https://schema.org");
    expect(schema["@type"]).toBe("WebApplication");
    expect(schema.applicationCategory).toBe("ProductivityApplication");
    // Pin the brand name exactly — a typo that left length>0 (e.g.
    // "youtubeai.cha") would still ship a broken brand string to Google.
    expect(schema.name).toBe("YouTube AI Chat");
    expect(schema.alternateName).toBe("youtubeai.chat");
    expect(schema.description.length).toBeGreaterThan(0);
    expect(schema.url).toMatch(/^https:\/\/www\.youtubeai\.chat/);
  });

  it("advertises the chat-with-transcript capability in featureList", () => {
    expect(schema.featureList).toContain("Chat with YouTube video transcript");
    expect(schema.featureList.length).toBeGreaterThan(0);
    schema.featureList.forEach((entry) => {
      expect(typeof entry).toBe("string");
      expect(entry.length).toBeGreaterThan(0);
    });
  });

  it("declares a free Offer", () => {
    expect(schema.offers["@type"]).toBe("Offer");
    expect(schema.offers.price).toBe("0");
    expect(schema.offers.priceCurrency).toBe("USD");
  });

  it("serializes without throwing", () => {
    expect(() => JSON.stringify(schema)).not.toThrow();
  });
});

describe("buildBreadcrumbSchema", () => {
  it("emits one ListItem per crumb at 1-indexed positions", () => {
    const schema = buildBreadcrumbSchema([
      { name: "Home", path: "/" },
      { name: "Terms", path: "/terms" },
    ]);
    expect(schema["@type"]).toBe("BreadcrumbList");
    expect(schema.itemListElement).toHaveLength(2);
    expect(schema.itemListElement[0]).toMatchObject({
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: "https://www.youtubeai.chat/",
    });
    expect(schema.itemListElement[1]).toMatchObject({
      position: 2,
      name: "Terms",
      item: "https://www.youtubeai.chat/terms",
    });
  });

  it("handles empty crumbs without throwing", () => {
    const schema = buildBreadcrumbSchema([]);
    expect(schema.itemListElement).toEqual([]);
  });
});

describe("buildWebPageSchema", () => {
  const schema = buildWebPageSchema({
    name: "Privacy Policy",
    description: "Privacy policy and data handling practices.",
    path: "/privacy",
  });

  it("declares WebPage with absolute url and the input fields", () => {
    expect(schema["@type"]).toBe("WebPage");
    expect(schema.name).toBe("Privacy Policy");
    expect(schema.description).toMatch(/.+/);
    expect(schema.url).toBe("https://www.youtubeai.chat/privacy");
  });

  it("nests an absolute-URL WebSite as isPartOf and Organization as publisher", () => {
    expect(schema.isPartOf).toMatchObject({
      "@type": "WebSite",
      url: "https://www.youtubeai.chat",
    });
    expect(schema.publisher).toMatchObject({
      "@type": "Organization",
      // Pin to the same brand string buildOrganizationSchema uses so a
      // brand rename can't drift the publisher field out of sync.
      name: "YouTube AI Chat",
      url: "https://www.youtubeai.chat",
    });
  });
});
