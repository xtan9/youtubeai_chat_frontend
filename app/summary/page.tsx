import { YouTubeSummarizerApp } from "@/app/summary/components/youtube-summarizer-app";
import { Metadata } from "next";
import { JsonLd } from "@/components/seo/json-ld";
import { buildBreadcrumbSchema } from "@/components/seo/breadcrumb-schema";

type SearchParams = Promise<{ url?: string }>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const params = await searchParams;
  // Bare `/summary` is the indexable tool landing page (it's in sitemap.ts).
  // `/summary?url=...` renders user-submitted dynamic content; we don't want
  // Google indexing arbitrary YouTube URLs canonicalized under our domain,
  // so noindex those variants.
  const isResultsView = Boolean(params.url);
  return {
    title: "YouTube Video Summary - AI-Generated Key Points & Insights",
    description:
      "Instant AI-generated summary with key points and insights from your YouTube video. Save time with our free YouTube summarizer tool.",
    alternates: {
      canonical: "/summary",
    },
    ...(isResultsView && { robots: { index: false, follow: false } }),
  };
}

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  return (
    <>
      <h1 className="sr-only">
        YouTube Video Summary - AI-Generated Key Points & Insights
      </h1>
      <YouTubeSummarizerApp initialUrl={params.url} />
      <JsonLd
        id="structured-data-breadcrumb"
        data={buildBreadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Summary", path: "/summary" },
        ])}
      />
    </>
  );
}
