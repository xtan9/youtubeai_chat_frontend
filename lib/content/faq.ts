import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";

// Loader for content/faq/*.mdx. Each file = one Q&A. The /faq page reads
// all of them, groups by category, and renders them with a single
// FAQPage JSON-LD spanning the whole page (the answer-engine surface
// most likely to get cited by ChatGPT / Perplexity / Google AI Overviews).

export const FAQ_CATEGORIES = [
  "pricing",
  "accuracy",
  "privacy",
  "features",
  "troubleshooting",
] as const;

export type FaqCategory = (typeof FAQ_CATEGORIES)[number];

export const FAQ_CATEGORY_LABELS: Record<FaqCategory, string> = {
  pricing: "Pricing & access",
  accuracy: "Accuracy & quality",
  privacy: "Privacy & data",
  features: "Features",
  troubleshooting: "Troubleshooting",
};

export const FaqEntryFrontmatterSchema = z.object({
  question: z.string().min(8).max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  category: z.enum(FAQ_CATEGORIES),
  order: z.number().int().nonnegative().default(100),
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  relatedBlogSlugs: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
});

export type FaqEntryFrontmatter = z.infer<typeof FaqEntryFrontmatterSchema>;

export type FaqEntry = FaqEntryFrontmatter & {
  slug: string;
  body: string;
  // Plain-text version of body for FAQPage JSON-LD answer text.
  answerText: string;
};

const CONTENT_DIR = path.join(process.cwd(), "content", "faq");

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

function deriveSlugFromFilename(filename: string): string {
  return filename.replace(/\.mdx?$/, "");
}

// Strip markdown to plaintext for the JSON-LD answer field. Crawlers
// don't render markdown — they need the literal answer string.
function markdownToPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "") // fenced code
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!\[[^\]]*]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1") // links → label
    .replace(/[#>*_~]/g, "") // bold/italic/headings/blockquotes
    .replace(/\n{2,}/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function loadAllFaqEntries(opts: { includeDrafts?: boolean } = {}): FaqEntry[] {
  const includeDrafts = opts.includeDrafts ?? false;
  const files = safeReaddir(CONTENT_DIR).filter((f) => /\.mdx?$/.test(f));

  const entries: FaqEntry[] = files.map((filename) => {
    const filePath = path.join(CONTENT_DIR, filename);
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = matter(raw);
    const frontmatter = FaqEntryFrontmatterSchema.parse(parsed.data);
    const slug = frontmatter.slug ?? deriveSlugFromFilename(filename);
    const body = parsed.content.trim();
    return {
      ...frontmatter,
      slug,
      body,
      answerText: markdownToPlainText(body),
    };
  });

  const visible = includeDrafts ? entries : entries.filter((e) => !e.draft);
  // Group order is fixed by FAQ_CATEGORIES; within a category, sort by `order` then question.
  return visible.sort((a, b) => {
    const catCmp =
      FAQ_CATEGORIES.indexOf(a.category) - FAQ_CATEGORIES.indexOf(b.category);
    if (catCmp !== 0) return catCmp;
    if (a.order !== b.order) return a.order - b.order;
    return a.question.localeCompare(b.question);
  });
}

export function groupFaqByCategory(
  entries: FaqEntry[],
): Array<{ category: FaqCategory; label: string; entries: FaqEntry[] }> {
  return FAQ_CATEGORIES.map((cat) => ({
    category: cat,
    label: FAQ_CATEGORY_LABELS[cat],
    entries: entries.filter((e) => e.category === cat),
  })).filter((g) => g.entries.length > 0);
}
