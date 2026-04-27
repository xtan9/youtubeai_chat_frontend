import { faqItems } from "@/app/components/faq-items";
import { buildFaqSchema } from "@/components/seo/faq-schema";
import { JsonLd } from "@/components/seo/json-ld";

export default function FaqJsonLd() {
  return <JsonLd id="structured-data-faq" data={buildFaqSchema(faqItems)} />;
}
