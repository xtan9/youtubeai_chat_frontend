import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/seo/json-ld";
import { buildBreadcrumbSchema } from "@/components/seo/breadcrumb-schema";
import { buildBlogPostingSchema } from "@/components/seo/article-schema";
import { buildVideoObjectSchema } from "@/components/seo/video-object-schema";
import { buildFaqSchema } from "@/components/seo/faq-schema";
import {
  loadAllBlogSlugs,
  loadBlogPost,
  loadRelatedBlogPosts,
} from "@/lib/content/blog";
import { BlogMarkdown } from "../components/blog-markdown";
import { Breadcrumbs } from "../components/breadcrumbs";
import { CtaCard } from "../components/cta-card";
import { InlineFaq } from "../components/inline-faq";
import { PostCard } from "../components/post-card";
import { formatPostDate } from "@/lib/content/format-date";

export function generateStaticParams() {
  return loadAllBlogSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = loadBlogPost(slug);
  if (!post) return { title: "Post not found" };
  const url = `/blog/${post.slug}`;
  const ogImage = post.ogImage ?? "/youtube-summary-demo.png";
  return {
    title: `${post.title} | YouTubeAI`,
    description: post.description,
    alternates: { canonical: url },
    authors: [{ name: post.author }],
    keywords: post.tags,
    openGraph: {
      title: post.title,
      description: post.description,
      url,
      type: "article",
      publishedTime: `${post.publishedAt}T00:00:00Z`,
      modifiedTime: `${post.updatedAt}T00:00:00Z`,
      authors: [post.author],
      images: [{ url: ogImage }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [ogImage],
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = loadBlogPost(slug);
  if (!post) notFound();

  const related = loadRelatedBlogPosts(post);
  const videoSchema = buildVideoObjectSchema(post);
  const inlineFaq = post.faq ?? [];

  const formattedDate = formatPostDate(post.publishedAt, "long");

  return (
    <article className="container mx-auto px-4 py-12 max-w-5xl">
      <JsonLd
        id="structured-data-breadcrumb"
        data={buildBreadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Blog", path: "/blog" },
          { name: post.title, path: `/blog/${post.slug}` },
        ])}
      />
      <JsonLd
        id="structured-data-blogposting"
        data={buildBlogPostingSchema(post)}
      />
      {videoSchema && (
        <JsonLd id="structured-data-video" data={videoSchema} />
      )}
      {inlineFaq.length > 0 && (
        <JsonLd
          id="structured-data-post-faq"
          data={buildFaqSchema(
            inlineFaq.map((f) => ({ question: f.q, answer: f.a })),
          )}
        />
      )}

      <Breadcrumbs
        crumbs={[
          { name: "Home", href: "/" },
          { name: "Blog", href: "/blog" },
          { name: post.title },
        ]}
      />

      <header className="max-w-3xl mx-auto mb-8">
        <div className="flex items-center gap-2 text-caption text-text-muted mb-3">
          <span className="uppercase tracking-wider">{post.category}</span>
          <span>·</span>
          <time dateTime={post.publishedAt}>{formattedDate}</time>
          {post.updatedAt !== post.publishedAt && (
            <>
              <span>·</span>
              <span>updated {post.updatedAt}</span>
            </>
          )}
        </div>
        <h1 className="text-h1 font-bold text-text-primary tracking-tight mb-4">
          {post.title}
        </h1>
        <p className="text-body-lg text-text-secondary leading-relaxed">
          {post.description}
        </p>
      </header>

      {post.heroVideo && (
        <CtaCard
          videoUrl={post.heroVideo.url}
          videoTitle={post.heroVideo.title}
        />
      )}

      <BlogMarkdown>{post.body}</BlogMarkdown>

      {inlineFaq.length > 0 && <InlineFaq items={inlineFaq} />}

      {related.length > 0 && (
        <section className="mt-16 max-w-5xl mx-auto">
          <h2 className="text-h2 font-bold text-text-primary mb-6">
            Related posts
          </h2>
          <div className="grid gap-6 md:grid-cols-3">
            {related.map((p) => (
              <PostCard key={p.slug} post={p} />
            ))}
          </div>
        </section>
      )}

    </article>
  );
}
