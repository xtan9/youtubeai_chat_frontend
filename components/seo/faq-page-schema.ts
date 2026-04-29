import type { FaqEntry } from "@/lib/content/faq";

// Same shape as buildFaqSchema (which lives next to it) but takes the
// FaqEntry type from the new content pipeline. Kept as a separate
// builder so the homepage's curated top-6 list (faq-items.ts → original
// builder) and the full /faq page have independent surfaces.
export function buildFaqPageSchema(entries: FaqEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((e) => ({
      "@type": "Question",
      name: e.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: e.answerText,
      },
    })),
  };
}
