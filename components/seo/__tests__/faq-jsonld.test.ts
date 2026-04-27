import { describe, it, expect } from "vitest";
import { faqItems } from "@/app/components/faq-items";
import { buildFaqSchema } from "@/components/seo/faq-schema";

describe("buildFaqSchema", () => {
  const schema = buildFaqSchema(faqItems);

  it("declares FAQPage at the top level", () => {
    expect(schema["@context"]).toBe("https://schema.org");
    expect(schema["@type"]).toBe("FAQPage");
  });

  it("emits one mainEntity per faq item", () => {
    expect(schema.mainEntity).toHaveLength(faqItems.length);
    expect(faqItems.length).toBeGreaterThan(0);
  });

  it("each mainEntity is a non-empty Question with a non-empty Answer", () => {
    for (const entry of schema.mainEntity) {
      expect(entry["@type"]).toBe("Question");
      expect(entry.name).toBeTypeOf("string");
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.acceptedAnswer["@type"]).toBe("Answer");
      expect(entry.acceptedAnswer.text).toBeTypeOf("string");
      expect(entry.acceptedAnswer.text.length).toBeGreaterThan(0);
    }
  });

  it("serializes to JSON without throwing", () => {
    expect(() => JSON.stringify(schema)).not.toThrow();
  });
});
