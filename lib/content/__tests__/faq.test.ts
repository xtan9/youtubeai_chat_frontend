import { describe, it, expect } from "vitest";
import {
  FaqEntryFrontmatterSchema,
  FAQ_CATEGORIES,
  loadAllFaqEntries,
  groupFaqByCategory,
  markdownToPlainText,
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

  it("rejects relatedBlogSlugs that aren't slug-shaped (typo guard)", () => {
    expect(() =>
      FaqEntryFrontmatterSchema.parse({
        ...valid,
        relatedBlogSlugs: ["Bad Slug With Spaces"],
      }),
    ).toThrow();
  });
});

describe("loadAllFaqEntries (against real seed)", () => {
  const entries = loadAllFaqEntries();

  it("loads at least the seeded set", () => {
    // Loosen exact count: this is a regression floor, not a target.
    // Seed currently has 8.
    expect(entries.length).toBeGreaterThanOrEqual(7);
  });

  it("every entry has a non-empty answerText (post-markdown-strip)", () => {
    for (const e of entries) {
      expect(e.answerText.length).toBeGreaterThan(20);
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

describe("markdownToPlainText", () => {
  it("strips fenced code blocks (multi-line)", () => {
    const input = "before\n```\ncode\nmore code\n```\nafter";
    expect(markdownToPlainText(input)).toBe("before after");
  });

  it("strips inline code preserving content", () => {
    expect(markdownToPlainText("use `npm install`")).toBe("use npm install");
  });

  it("renders links as their label, drops the URL", () => {
    expect(markdownToPlainText("see [the docs](https://example.com)")).toBe(
      "see the docs",
    );
  });

  it("strips images entirely", () => {
    expect(markdownToPlainText("![alt](img.png) before after")).toBe(
      "before after",
    );
  });

  it("strips bold and italic markers", () => {
    expect(markdownToPlainText("**bold** and *italic* and _em_")).toBe(
      "bold and italic and em",
    );
  });

  it("strips strikethrough markers", () => {
    expect(markdownToPlainText("~~old~~")).toBe("old");
  });

  it("strips heading markers", () => {
    expect(markdownToPlainText("# Title\nbody")).toBe("Title body");
  });

  it("strips blockquote markers", () => {
    expect(markdownToPlainText("> quoted line")).toBe("quoted line");
  });

  it("preserves a literal asterisk inside a math expression", () => {
    // Standalone non-formatting asterisks (with spaces) are NOT italic
    // markers and should pass through.
    const input = "5 * 2 = 10";
    expect(markdownToPlainText(input)).toContain("5 * 2 = 10");
  });

  it("collapses whitespace and trims", () => {
    expect(markdownToPlainText("  a  b\n\n\nc   ")).toBe("a b c");
  });

  it("handles nested bold-link", () => {
    expect(markdownToPlainText("**[bold link](https://x.com)**")).toBe(
      "bold link",
    );
  });
});
