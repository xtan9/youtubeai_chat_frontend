import { describe, it, expect } from "vitest";
import { buildHowToSchema } from "@/components/seo/howto-schema";
import { buildOrganizationSchema } from "@/components/seo/organization-schema";
import { buildBreadcrumbSchema } from "@/components/seo/breadcrumb-schema";

describe("buildHowToSchema", () => {
  const schema = buildHowToSchema();

  it("declares HowTo at the top level", () => {
    expect(schema["@context"]).toBe("https://schema.org");
    expect(schema["@type"]).toBe("HowTo");
    expect(schema.name).toMatch(/.+/);
    expect(schema.description).toMatch(/.+/);
  });

  it("emits 4 sequential HowToSteps with non-empty content", () => {
    expect(schema.step).toHaveLength(4);
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

  it("declares Organization with absolute URLs", () => {
    expect(schema["@type"]).toBe("Organization");
    expect(schema.name.length).toBeGreaterThan(0);
    expect(schema.description.length).toBeGreaterThan(0);
    expect(schema.url).toMatch(/^https:\/\/www\.youtubeai\.chat/);
    expect(schema.logo).toMatch(/^https:\/\/www\.youtubeai\.chat.+\.(png|jpg|svg)$/);
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
