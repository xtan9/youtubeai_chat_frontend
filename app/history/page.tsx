import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getHistoryPage } from "@/lib/services/user-history";
import { HistoryList } from "@/app/components/history/history-list";
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

  const { rows, totalPages } = await getHistoryPage(
    supabase,
    user.id,
    page,
    PER_PAGE,
  );

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-h2 font-bold text-text-primary">Your summaries</h1>
        <p className="text-body-md text-text-secondary">
          Every YouTube video you&apos;ve summarized.
        </p>
      </header>

      <HistoryList rows={rows} />
      <HistoryPagination current={page} totalPages={totalPages} />
    </main>
  );
}
