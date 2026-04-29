import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { BlogPost } from "@/lib/content/blog";
import { formatPostDate } from "@/lib/content/format-date";

const CATEGORY_LABELS: Record<BlogPost["category"], string> = {
  workflows: "Workflow",
  comparisons: "Comparison",
  tutorials: "Tutorial",
  news: "News",
};

export function PostCard({ post }: { post: BlogPost }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group block rounded-xl border border-border-subtle bg-surface-raised p-6 hover:border-border-default hover:bg-state-hover transition-colors"
    >
      <div className="flex items-center gap-2 text-caption text-text-muted mb-3">
        <span className="uppercase tracking-wider">
          {CATEGORY_LABELS[post.category]}
        </span>
        <span>·</span>
        <time dateTime={post.publishedAt}>
          {formatPostDate(post.publishedAt)}
        </time>
      </div>
      <h3 className="text-h4 font-semibold text-text-primary group-hover:text-accent-brand transition-colors mb-2">
        {post.title}
      </h3>
      <p className="text-body-sm text-text-secondary line-clamp-3 mb-4">
        {post.description}
      </p>
      <div className="flex items-center gap-1 text-body-sm font-medium text-accent-brand">
        Read more
        <ArrowRight
          size={16}
          className="group-hover:translate-x-1 transition-transform"
        />
      </div>
    </Link>
  );
}
