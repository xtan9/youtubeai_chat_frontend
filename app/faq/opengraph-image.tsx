import { buildOgCard, ogContentType, ogSize } from "@/components/seo/og-card";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "YouTube AI Chat FAQ — answers about pricing, accuracy, and privacy";

export default function OG() {
  return buildOgCard({
    eyebrow: "FAQ",
    title: "Frequently asked questions",
    subtitle:
      "Quick answers about how YouTube AI Chat works, what it costs, and how your data is handled.",
  });
}
