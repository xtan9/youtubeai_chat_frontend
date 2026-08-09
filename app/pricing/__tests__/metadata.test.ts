import { describe, expect, it } from "vitest";
import { metadata } from "../page";

describe("Pricing metadata", () => {
  it("identifies Pricing with a dedicated canonical and social URL", () => {
    expect(metadata.title).toBe("Pricing | YouTube AI Chat");
    expect(metadata.description).toMatch(/Free Plan.*Pro Plan/i);
    expect(metadata.alternates).toEqual({ canonical: "/pricing" });
    expect(metadata.openGraph).toMatchObject({
      title: "Pricing | YouTube AI Chat",
      url: "/pricing",
      type: "website",
    });
  });
});
