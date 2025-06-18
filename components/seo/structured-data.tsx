export default function StructuredData() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "YouTubeAI Summary",
    applicationCategory: "UtilityApplication",
    operatingSystem: "Any",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    description:
      "Transform any YouTube video into a concise summary instantly. Get key points, main ideas, and quick insights from videos using AI - 100% free tool for faster video comprehension.",
    featureList: [
      "Instant YouTube video summarization",
      "Key points extraction",
      "Main ideas identification",
      "Free to use",
      "AI-powered analysis",
      "Quick video insights",
      "Transcript generation",
    ],
    browserRequirements: "Requires JavaScript. Requires HTML5.",
    permissions: "YouTube video URL required",
    softwareVersion: "1.0",
    potentialAction: {
      "@type": "UseAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: "https://youtubeai.chat",
        description:
          "Enter a YouTube video URL to get an instant AI-powered summary",
      },
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
    />
  );
}
