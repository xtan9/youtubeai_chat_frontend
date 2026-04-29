import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";

// Loader for content/blog/*.mdx. Server-only — uses fs. Reads the entire
// directory at build time so generateStaticParams can pre-render every
// slug. Frontmatter is validated with Zod; a malformed file fails the
// build, which is the anti-slop guardrail (a hallucinated post that
// drops a required field doesn't ship).

const HeroVideoSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  channel: z.string().min(1).optional(),
  durationSec: z.number().int().positive().optional(),
});

const FaqInlineSchema = z.object({
  q: z.string().min(1),
  a: z.string().min(1),
});

export const BlogPostFrontmatterSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(20).max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  author: z.string().default("YouTubeAI Team"),
  category: z.enum(["workflows", "comparisons", "tutorials", "news"]),
  tags: z.array(z.string()).default([]),
  heroVideo: HeroVideoSchema.optional(),
  ogImage: z.string().optional(),
  faq: z.array(FaqInlineSchema).optional(),
  draft: z.boolean().default(false),
});

export type BlogPostFrontmatter = z.infer<typeof BlogPostFrontmatterSchema>;

export type BlogPost = BlogPostFrontmatter & {
  slug: string;
  body: string;
  updatedAt: string;
};

const CONTENT_DIR = path.join(process.cwd(), "content", "blog");

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

function deriveSlugFromFilename(filename: string): string {
  // content/blog/2026-04-summarize-podcast.mdx → summarize-podcast
  const base = filename.replace(/\.mdx?$/, "");
  return base.replace(/^\d{4}-\d{2}-/, "");
}

export function loadAllBlogPosts(opts: { includeDrafts?: boolean } = {}): BlogPost[] {
  const includeDrafts = opts.includeDrafts ?? false;
  const files = safeReaddir(CONTENT_DIR).filter((f) => /\.mdx?$/.test(f));

  const posts: BlogPost[] = files.map((filename) => {
    const filePath = path.join(CONTENT_DIR, filename);
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = matter(raw);
    const frontmatter = BlogPostFrontmatterSchema.parse(parsed.data);
    const slug = frontmatter.slug ?? deriveSlugFromFilename(filename);

    if (frontmatter.category === "workflows" && !frontmatter.heroVideo) {
      throw new Error(
        `[blog] ${filename}: workflow posts require a heroVideo frontmatter ` +
          `block (real video anchor). This is the anti-slop rule. Either ` +
          `change category, or add heroVideo: { url, title }.`,
      );
    }

    return {
      ...frontmatter,
      slug,
      body: parsed.content,
      updatedAt: frontmatter.updatedAt ?? frontmatter.publishedAt,
    };
  });

  const visible = includeDrafts ? posts : posts.filter((p) => !p.draft);
  // Newest first.
  return visible.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
}

export function loadBlogPost(slug: string): BlogPost | null {
  return loadAllBlogPosts().find((p) => p.slug === slug) ?? null;
}

export function loadAllBlogSlugs(): string[] {
  return loadAllBlogPosts().map((p) => p.slug);
}

export function loadRelatedBlogPosts(post: BlogPost, limit = 3): BlogPost[] {
  const others = loadAllBlogPosts().filter((p) => p.slug !== post.slug);
  if (others.length === 0) return [];
  // Score by tag overlap, then category match, then recency.
  return others
    .map((p) => {
      const tagOverlap = p.tags.filter((t) => post.tags.includes(t)).length;
      const sameCategory = p.category === post.category ? 1 : 0;
      return { post: p, score: tagOverlap * 2 + sameCategory };
    })
    .sort((a, b) =>
      a.score === b.score
        ? a.post.publishedAt < b.post.publishedAt
          ? 1
          : -1
        : b.score - a.score,
    )
    .slice(0, limit)
    .map((s) => s.post);
}
