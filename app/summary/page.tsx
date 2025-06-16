import { YouTubeSummarizerApp } from "@/app/components/youtube-summarizer-app";

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  const params = await searchParams;
  return <YouTubeSummarizerApp initialUrl={params.url} />;
}
