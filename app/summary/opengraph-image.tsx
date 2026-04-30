import { buildOgCard, ogContentType, ogSize } from "@/components/seo/og-card";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "Free AI summary for any YouTube video";

export default function OG() {
  return buildOgCard({
    title: "Free AI summary for any YouTube video",
    subtitle:
      "Paste a YouTube URL and our AI extracts the key points, themes, and insights in seconds.",
  });
}
