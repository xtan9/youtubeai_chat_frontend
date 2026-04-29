import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { isYouTubeUrl } from "@/lib/youtube-url";

// Anti-slop guardrail lives in the type system: workflow posts are a
// schema branch that *requires* heroVideo, so a draft missing the real
// video anchor fails Zod parsing — not a hand-thrown runtime error
// downstream. heroVideo.url is further refined to a YouTube URL so
// non-YouTube anchors (Vimeo, raw mp4) can't slip through and produce
// a malformed VideoObject schema on the post page.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9-]+$/;

const HeroVideoSchema = z.object({
  url: z
    .string()
    .url()
    .refine(isYouTubeUrl, {
      message:
        "heroVideo.url must be a YouTube URL (watch, youtu.be, shorts, or embed form)",
    }),
  title: z.string().min(1),
  channel: z.string().min(1).optional(),
  durationSec: z.number().int().positive().optional(),
});

const FaqInlineSchema = z.object({
  q: z.string().min(1),
  a: z.string().min(1),
});

const baseFields = {
  title: z.string().min(1),
  description: z.string().min(20).max(200),
  slug: z.string().regex(SLUG).optional(),
  publishedAt: z.string().regex(ISO_DATE),
  updatedAt: z.string().regex(ISO_DATE).optional(),
  author: z.string().default("YouTubeAI Team"),
  tags: z.array(z.string()).default([]),
  ogImage: z.string().optional(),
  faq: z.array(FaqInlineSchema).optional(),
  draft: z.boolean().default(false),
};

export const BlogPostFrontmatterSchema = z.discriminatedUnion("category", [
  z.object({
    ...baseFields,
    category: z.literal("workflows"),
    heroVideo: HeroVideoSchema,
  }),
  z.object({
    ...baseFields,
    category: z.literal("tutorials"),
    heroVideo: HeroVideoSchema.optional(),
  }),
  z.object({
    ...baseFields,
    category: z.literal("comparisons"),
    heroVideo: HeroVideoSchema.optional(),
  }),
  z.object({
    ...baseFields,
    category: z.literal("news"),
    heroVideo: HeroVideoSchema.optional(),
  }),
]);

export type BlogPostFrontmatter = z.infer<typeof BlogPostFrontmatterSchema>;

// `slug`, `updatedAt` and `body` are all guaranteed by the loader (default
// values applied), so consumers never have to null-check them.
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
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      // Warn once: a missing content dir is usually a path typo or a
      // forgotten scaffold, NOT a deliberate "we have no posts" state.
      // Silent return would let an entire SEO surface go empty without
      // a single log line.
      console.warn(`[content] expected directory missing: ${dir}`);
      return [];
    }
    throw e;
  }
}

function deriveSlugFromFilename(filename: string): string {
  const base = filename.replace(/\.mdx?$/, "");
  return base.replace(/^\d{4}-\d{2}-/, "");
}

function parseFile(filename: string, raw: string): BlogPost {
  const parsed = matter(raw);
  const result = BlogPostFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    // Zod's default message lists path arrays but not which file —
    // unhelpful when a content batch has 20 posts. Re-throw with the
    // filename so the build error tells you exactly where to look.
    throw new Error(
      `[blog] ${filename}: ${z.prettifyError(result.error)}`,
    );
  }
  const frontmatter = result.data;
  const slug = frontmatter.slug ?? deriveSlugFromFilename(filename);
  return {
    ...frontmatter,
    slug,
    body: parsed.content,
    updatedAt: frontmatter.updatedAt ?? frontmatter.publishedAt,
  };
}

export function loadAllBlogPosts(opts: { includeDrafts?: boolean } = {}): BlogPost[] {
  const includeDrafts = opts.includeDrafts ?? false;
  const files = safeReaddir(CONTENT_DIR).filter((f) => /\.mdx?$/.test(f));

  const posts: BlogPost[] = files.map((filename) => {
    const filePath = path.join(CONTENT_DIR, filename);
    const raw = fs.readFileSync(filePath, "utf8");
    return parseFile(filename, raw);
  });

  const visible = includeDrafts ? posts : posts.filter((p) => !p.draft);
  return visible.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
}

export function loadBlogPost(slug: string): BlogPost | null {
  return loadAllBlogPosts().find((p) => p.slug === slug) ?? null;
}

export function loadAllBlogSlugs(): string[] {
  return loadAllBlogPosts().map((p) => p.slug);
}

export function loadRelatedBlogPosts(post: BlogPost, limit = 3): BlogPost[] {
  return scoreRelatedPosts(post, loadAllBlogPosts(), limit);
}

// Pure scoring function — exposed for unit testing without disk I/O.
// Score = tag overlap × 2 + same-category bonus; ties broken by recency.
export function scoreRelatedPosts(
  source: BlogPost,
  candidates: BlogPost[],
  limit = 3,
): BlogPost[] {
  const others = candidates.filter((p) => p.slug !== source.slug);
  return others
    .map((p) => {
      const tagOverlap = p.tags.filter((t) => source.tags.includes(t)).length;
      const sameCategory = p.category === source.category ? 1 : 0;
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
