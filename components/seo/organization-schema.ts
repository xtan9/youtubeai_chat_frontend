// Organization schema for brand-query SERP appearance and to claim the
// site's logo + social profile in Google's knowledge graph. Lives in the
// root layout so every page emits it.
export function buildOrganizationSchema() {
  // `name` matches WebApplication.name so Google can consolidate the brand
  // into a single Knowledge Graph entity. `logo` is intentionally omitted
  // — the prior `/favicon-96x96.png` URL 404'd in production and we don't
  // yet have a designed logo PNG. Re-add `logo` once a proper raster asset
  // ships; Google's logo guidance prefers PNG/SVG over ICO.
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "youtubeai.chat",
    url: "https://www.youtubeai.chat",
    description:
      "Free AI-powered YouTube video summarizer. Extracts key points, themes, and insights from any public YouTube video.",
  };
}
