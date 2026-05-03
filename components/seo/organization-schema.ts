// Organization schema for brand-query SERP appearance and to claim the
// site's logo + social profile in Google's knowledge graph. Lives in the
// root layout so every page emits it.
//
// `name` matches WebApplication.name so Google can consolidate the brand
// into a single Knowledge Graph entity. `logo` points at /logo.svg — a
// 512×512 mark with the gradient backplate baked in, which is what
// Google expects (PNG or SVG, square, on a solid/transparent background).
export function buildOrganizationSchema() {
  const url = "https://www.youtubeai.chat";
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "YouTube AI Chat",
    alternateName: "youtubeai.chat",
    url,
    logo: `${url}/logo.svg`,
    description:
      "Free AI-powered YouTube video summarizer and chat. Extracts key points, themes, and insights from any public YouTube video.",
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "contact@youtubeai.chat",
      availableLanguage: ["English"],
    },
  };
}
