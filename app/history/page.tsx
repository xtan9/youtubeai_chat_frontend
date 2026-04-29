import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getHistoryPage } from "@/lib/services/user-history";
import { getChatMessageCounts } from "@/lib/services/chat-counts";
import { HistoryList } from "@/app/components/history/history-list";
import { HistoryFetchError } from "@/app/components/history/history-fetch-error";
import { HistoryPagination } from "./components/history-pagination";

export const metadata: Metadata = {
  title: "Your summaries - YouTubeAI.chat",
  robots: { index: false, follow: false },
};

const PER_PAGE = 25;

type SearchParams = Promise<{ page?: string }>;

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const params = await searchParams;
  const parsed = parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

  const result = await getHistoryPage(supabase, user.id, page, PER_PAGE);

  // Bookmarked or shared deep links can land past the end of the list. Bounce
  // back to the last valid page so the user sees real content instead of the
  // "no summaries yet" empty state — that copy would mislead a user who
  // actually has summaries on earlier pages.
  if (result.ok && result.totalPages > 0 && page > result.totalPages) {
    redirect(`/history?page=${result.totalPages}`);
  }

  // Chat-count badges. Fail-soft: an empty Map yields no badges rather
  // than blocking the page render.
  const chatCounts = result.ok
    ? await getChatMessageCounts(
        supabase,
        user.id,
        result.rows.map((row) => row.videoId),
      )
    : new Map<string, number>();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-h2 font-bold text-text-primary">Your summaries</h1>
        <p className="text-body-md text-text-secondary">
          Every YouTube video you&apos;ve summarized.
        </p>
      </header>

      {result.ok ? (
        <>
          <HistoryList rows={result.rows} chatCounts={chatCounts} />
          <HistoryPagination
            current={page}
            totalPages={result.totalPages}
          />
        </>
      ) : (
        <HistoryFetchError message="Couldn't load your summaries. Please try again later." />
      )}
    </main>
  );
}
