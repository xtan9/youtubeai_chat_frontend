// `WebPage` is the right schema for static legal/info pages — `Article`
// implies editorial content with an author and dateline, which legal docs
// aren't. Pulls in Organization as the publisher so brand-query SERP
// features stay consistent.
type WebPageInput = {
  name: string;
  description: string;
  path: string;
};

export function buildWebPageSchema({
  name,
  description,
  path,
}: WebPageInput) {
  const url = `https://www.youtubeai.chat${path}`;
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name,
    description,
    url,
    isPartOf: {
      "@type": "WebSite",
      name: "youtubeai.chat",
      url: "https://www.youtubeai.chat",
    },
    publisher: {
      "@type": "Organization",
      name: "youtubeai.chat",
      url: "https://www.youtubeai.chat",
    },
  };
}
