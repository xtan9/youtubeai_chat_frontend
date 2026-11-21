import { describe, expect, it, vi } from "vitest";
import messages from "@/i18n/messages/en.json";
import { generateMetadata } from "../page";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: keyof typeof messages.pricing) => messages.pricing[key],
}));

describe("Pricing metadata", () => {
  it("identifies Pricing with a dedicated canonical and social URL", async () => {
    const metadata = await generateMetadata();
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
