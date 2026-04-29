import { describe, it, expect } from "vitest";
import {
  FaqEntryFrontmatterSchema,
  FAQ_CATEGORIES,
  loadAllFaqEntries,
  groupFaqByCategory,
} from "@/lib/content/faq";

describe("FaqEntryFrontmatterSchema", () => {
  const valid = {
    question: "Is this thing free?",
    category: "pricing",
    updatedAt: "2026-04-28",
  };

  it("accepts minimal valid frontmatter", () => {
    const r = FaqEntryFrontmatterSchema.parse(valid);
    expect(r.order).toBe(100);
    expect(r.draft).toBe(false);
    expect(r.relatedBlogSlugs).toEqual([]);
  });

  it("rejects unknown category", () => {
    expect(() =>
      FaqEntryFrontmatterSchema.parse({ ...valid, category: "ufology" }),
    ).toThrow();
  });

  it("rejects too-short question", () => {
    expect(() =>
      FaqEntryFrontmatterSchema.parse({ ...valid, question: "Free?" }),
    ).toThrow();
  });
});

describe("loadAllFaqEntries", () => {
  const entries = loadAllFaqEntries();

  it("loads at least the seed entries", () => {
    expect(entries.length).toBeGreaterThanOrEqual(7);
  });

  it("every entry has a non-empty answerText (post-markdown-strip)", () => {
    for (const e of entries) {
      expect(e.answerText.length).toBeGreaterThan(20);
    }
  });

  it("answerText has no markdown noise", () => {
    for (const e of entries) {
      expect(e.answerText).not.toMatch(/^[#>*]/);
      expect(e.answerText).not.toMatch(/```/);
    }
  });

  it("groups categories in the canonical order", () => {
    const groups = groupFaqByCategory(entries);
    const seen = groups.map((g) => g.category);
    for (let i = 0; i < seen.length - 1; i++) {
      const a = FAQ_CATEGORIES.indexOf(seen[i]);
      const b = FAQ_CATEGORIES.indexOf(seen[i + 1]);
      expect(a < b).toBe(true);
    }
  });

  it("excludes drafts by default", () => {
    expect(entries.every((e) => e.draft === false)).toBe(true);
  });
});
