import { JsonLd } from "./json-ld";
import { buildOrganizationSchema } from "./organization-schema";
import { buildWebApplicationSchema } from "./webapp-schema";

const serviceSchema = {
  "@context": "https://schema.org",
  "@type": "Service",
  name: "YouTube Video Summarization",
  description:
    "AI-powered service that creates concise summaries of YouTube videos, extracting key points and main ideas.",
  serviceType: "Content Summarization",
  areaServed: "Worldwide",
  url: "https://www.youtubeai.chat",
};

export default function StructuredData() {
  return (
    <>
      <JsonLd id="structured-data-webapp" data={buildWebApplicationSchema()} />
      <JsonLd id="structured-data-service" data={serviceSchema} />
      <JsonLd
        id="structured-data-organization"
        data={buildOrganizationSchema()}
      />
    </>
  );
}
