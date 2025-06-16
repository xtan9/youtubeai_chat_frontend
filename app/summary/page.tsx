import { YouTubeSummarizerApp } from "@/app/components/youtube-summarizer-app";

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; reasoning?: string }>;
}) {
  const params = await searchParams;
  const useReasoning = params.reasoning === "true";

  return (
    <YouTubeSummarizerApp
      initialUrl={params.url}
      enableReasoning={useReasoning}
    />
  );
}
