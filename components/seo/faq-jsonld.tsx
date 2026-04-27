import { faqItems } from "@/app/components/faq-items";
import { buildFaqSchema } from "@/components/seo/faq-schema";

export default function FaqJsonLd() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(buildFaqSchema(faqItems)),
      }}
    />
  );
}
