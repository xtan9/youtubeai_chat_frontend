import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/json-ld";
import { buildBreadcrumbSchema } from "@/components/seo/breadcrumb-schema";
import { buildBlogListingSchema } from "@/components/seo/blog-listing-schema";
import { loadAllBlogPosts } from "@/lib/content/blog";
import { PostCard } from "./components/post-card";
import { Breadcrumbs } from "./components/breadcrumbs";

export const metadata: Metadata = {
  title: "Blog — Workflows, Comparisons, and Tutorials | YouTubeAI",
  description:
    "Practical guides for getting more out of YouTube videos with AI: podcast summaries, tutorial repurposing, lecture notes, and tool comparisons.",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: "YouTubeAI Blog",
    description:
      "Workflows, comparisons, and tutorials for YouTube + AI summarization.",
    url: "/blog",
    type: "website",
  },
};

export default function BlogIndexPage() {
  const posts = loadAllBlogPosts();

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <JsonLd
        id="structured-data-breadcrumb"
        data={buildBreadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Blog", path: "/blog" },
        ])}
      />
      <JsonLd id="structured-data-blog" data={buildBlogListingSchema(posts)} />

      <Breadcrumbs
        crumbs={[
          { name: "Home", href: "/" },
          { name: "Blog" },
        ]}
      />

      <header className="mb-12">
        <h1 className="text-h1 font-bold text-text-primary tracking-tight mb-4">
          From the YouTubeAI blog
        </h1>
        <p className="text-body-lg text-text-secondary max-w-2xl">
          Workflows, comparisons, and tutorials for getting more out of YouTube
          videos with AI — written against real videos, not generic prompts.
        </p>
      </header>

      {posts.length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface-raised p-8 text-center">
          <p className="text-body-md text-text-secondary">
            No posts published yet. Check back soon.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {posts.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
