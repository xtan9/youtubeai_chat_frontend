import { JsonLd } from "./json-ld";
import { buildOrganizationSchema } from "./organization-schema";

const webAppSchema = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "youtubeai.chat",
  applicationCategory: "ProductivityApplication",
  description: "AI-powered YouTube video summarizer and chat tool",
  operatingSystem: "All",
  browserRequirements: "Requires JavaScript. Requires HTML5.",
  url: "https://www.youtubeai.chat",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  featureList: [
    "Instant video summarization",
    "Chat with YouTube video transcript",
    "AI-powered analysis",
    "Key points extraction",
    "Free to use",
  ],
};

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
      <JsonLd id="structured-data-webapp" data={webAppSchema} />
      <JsonLd id="structured-data-service" data={serviceSchema} />
      <JsonLd
        id="structured-data-organization"
        data={buildOrganizationSchema()}
      />
    </>
  );
}
