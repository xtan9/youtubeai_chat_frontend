import { buildOgCard, ogContentType, ogSize } from "@/components/seo/og-card";
import { loadBlogPost } from "@/lib/content/blog";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "YouTubeAI blog post";

export default async function OG({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = loadBlogPost(slug);
  // Slug not found shouldn't happen here in practice (the page would 404
  // before this handler runs), but Satori needs a string to render. Fall
  // back to the blog-index card rather than crashing the OG route.
  if (!post) {
    return buildOgCard({
      eyebrow: "Blog",
      title: "Workflows, comparisons, and tutorials",
      subtitle:
        "Practical guides for getting more out of YouTube videos with AI.",
    });
  }
  return buildOgCard({
    eyebrow: post.category,
    title: post.title,
    subtitle: post.description,
  });
}
