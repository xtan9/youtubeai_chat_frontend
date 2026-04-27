import { YouTubeSummarizerApp } from "@/app/summary/components/youtube-summarizer-app";
import { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "YouTube Video Summary - AI-Generated Key Points & Insights",
    description:
      "Instant AI-generated summary with key points and insights from your YouTube video. Save time with our free YouTube summarizer tool.",
    alternates: {
      canonical: "/summary",
    },
  };
}

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  const params = await searchParams;

  return (
    <>
      <h1 className="sr-only">
        YouTube Video Summary - AI-Generated Key Points & Insights
      </h1>
      <YouTubeSummarizerApp initialUrl={params.url} />
    </>
  );
}
