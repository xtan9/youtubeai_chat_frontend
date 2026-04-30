import { buildOgCard, ogContentType, ogSize } from "@/components/seo/og-card";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "YouTubeAI Blog — workflows, comparisons, and tutorials";

export default function OG() {
  return buildOgCard({
    eyebrow: "Blog",
    title: "Workflows, comparisons, and tutorials",
    subtitle:
      "Practical guides for getting more out of YouTube videos with AI.",
  });
}
