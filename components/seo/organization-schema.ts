// Organization schema for brand-query SERP appearance and to claim the
// site's logo + social profile in Google's knowledge graph. Lives in the
// root layout so every page emits it.
export function buildOrganizationSchema() {
  // `name` matches WebApplication.name so Google can consolidate the brand
  // into a single Knowledge Graph entity. `logo` omitted until a designed
  // PNG ships — Google's logo guidance prefers PNG/SVG over ICO, so we
  // can't just point this at /favicon.ico.
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "youtubeai.chat",
    url: "https://www.youtubeai.chat",
    description:
      "Free AI-powered YouTube video summarizer. Extracts key points, themes, and insights from any public YouTube video.",
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "contact@youtubeai.chat",
      availableLanguage: ["English"],
    },
  };
}
