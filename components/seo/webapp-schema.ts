// WebApplication schema — surfaces the homepage tool in Google's
// "Software / web app" listings and pins the productivity-tool
// positioning (vs. the broader UtilityApplication category) that the
// homepage copy targets.
export function buildWebApplicationSchema() {
  return {
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
}
