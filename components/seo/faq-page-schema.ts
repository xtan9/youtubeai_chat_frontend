import type { FaqEntry } from "@/lib/content/faq";

// Separate builder from buildFaqSchema (faq-schema.ts) so the homepage's
// curated top-6 surface and the full /faq page can evolve independently.
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
