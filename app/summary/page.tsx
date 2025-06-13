import { YouTubeSummarizerApp } from "@/app/components/youtube-summarizer-app";
import { createClient } from "@/lib/supabase/server";

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; streaming?: string }>;
}) {
  const params = await searchParams;
  const useStreaming = params.streaming === "true";
  return (
    <YouTubeSummarizerApp initialUrl={params.url} useStreaming={useStreaming} />
  );
}
