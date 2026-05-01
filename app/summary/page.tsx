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

  const isResultsView = Boolean(params.url);

  return (
    <>
      <h1 className="sr-only">
        YouTube Video Summary - AI-Generated Key Points & Insights
      </h1>
      {/* Server-rendered intro for the bare /summary landing — gives crawlers
          something to index since the YouTubeSummarizerApp is client-only.
          Hidden in the results view so submitted summaries aren't pushed
          below the fold. */}
      {!isResultsView && (
        <section className="w-full max-w-3xl mx-auto px-4 pt-12 pb-6 text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-4 bg-gradient-brand-accent bg-clip-text text-transparent">
            Free AI Summary for any YouTube Video
          </h2>
          <p className="text-base md:text-lg text-text-muted">
            Paste a YouTube URL below and our AI extracts the key points,
            themes, and insights in seconds. Works on any public video — even
            ones without captions — and reads back in 18 summary languages.
            No signup or paywall.
          </p>
        </section>
      )}
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
