// Organization schema for brand-query SERP appearance and to claim the
// site's logo + social profile in Google's knowledge graph. Lives in the
// root layout so every page emits it.
export function buildOrganizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "YouTubeAI Summary",
    url: "https://www.youtubeai.chat",
    logo: "https://www.youtubeai.chat/favicon-96x96.png",
    description:
      "Free AI-powered YouTube video summarizer. Extracts key points, themes, and insights from any public YouTube video.",
  };
}
