import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";

// Each FAQ entry's `body` is markdown for the human-facing page; its
// `answerText` is plaintext that gets embedded in the FAQPage JSON-LD,
// because crawlers + answer engines don't render markdown — they
// extract the literal answer string.

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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9-]+$/;

export const FaqEntryFrontmatterSchema = z.object({
  question: z.string().min(8).max(200),
  slug: z.string().regex(SLUG).optional(),
  category: z.enum(FAQ_CATEGORIES),
  order: z.number().int().nonnegative().default(100),
  updatedAt: z.string().regex(ISO_DATE),
  // Constrain to slug shape so a typo'd reference fails Zod parsing
  // instead of shipping a 404'ing internal link.
  relatedBlogSlugs: z.array(z.string().regex(SLUG)).default([]),
  draft: z.boolean().default(false),
});

export type FaqEntryFrontmatter = z.infer<typeof FaqEntryFrontmatterSchema>;

export type FaqEntry = FaqEntryFrontmatter & {
  slug: string;
  body: string;
  answerText: string;
};

const CONTENT_DIR = path.join(process.cwd(), "content", "faq");

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(`[content] expected directory missing: ${dir}`);
      return [];
    }
    throw e;
  }
}

function deriveSlugFromFilename(filename: string): string {
  return filename.replace(/\.mdx?$/, "");
}

// Strip markdown to plaintext for the JSON-LD answer field. Order
// matters: fenced code first (multi-line greedy), then inline tokens.
export function markdownToPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "") // fenced code (multi-line)
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!\[[^\]]*]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1") // links → label
    .replace(/^\s{0,3}>\s?/gm, "") // blockquote markers
    .replace(/^#{1,6}\s+/gm, "") // heading markers
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/(?<![\w*])\*([^*\n]+)\*(?!\w)/g, "$1") // italic *x*
    .replace(/_([^_\n]+)_/g, "$1") // italic _x_
    .replace(/~~([^~]+)~~/g, "$1") // strikethrough
    .replace(/\n{2,}/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFile(filename: string, raw: string): FaqEntry {
  const parsed = matter(raw);
  const result = FaqEntryFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    throw new Error(
      `[faq] ${filename}: ${z.prettifyError(result.error)}`,
    );
  }
  const frontmatter = result.data;
  const slug = frontmatter.slug ?? deriveSlugFromFilename(filename);
  const body = parsed.content.trim();
  return {
    ...frontmatter,
    slug,
    body,
    answerText: markdownToPlainText(body),
  };
}

export function loadAllFaqEntries(opts: { includeDrafts?: boolean } = {}): FaqEntry[] {
  const includeDrafts = opts.includeDrafts ?? false;
  const files = safeReaddir(CONTENT_DIR).filter((f) => /\.mdx?$/.test(f));

  const entries: FaqEntry[] = files.map((filename) => {
    const filePath = path.join(CONTENT_DIR, filename);
    const raw = fs.readFileSync(filePath, "utf8");
    return parseFile(filename, raw);
  });

  const visible = includeDrafts ? entries : entries.filter((e) => !e.draft);
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
