import Script from "next/script";

export default function StructuredData() {
  const webAppSchema = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "YouTubeAI Summary",
    applicationCategory: "UtilityApplication",
    description:
      "Transform any YouTube video into a concise summary instantly using AI technology.",
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

  return (
    <>
      <Script
        id="structured-data-webapp"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webAppSchema) }}
      />
      <Script
        id="structured-data-service"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceSchema) }}
      />
    </>
  );
}
