import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getRecentHistory } from "@/lib/services/user-history";
import { getChatMessageCounts } from "@/lib/services/chat-counts";
import { InputForm } from "@/app/components/input-form";
import { HistoryList } from "@/app/components/history/history-list";
import { HistoryFetchError } from "@/app/components/history/history-fetch-error";

export const metadata: Metadata = {
  title: "Dashboard - YouTubeAI.chat",
  robots: { index: false, follow: false },
};

const RECENT_LIMIT = 10;

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) redirect("/auth/login");

  const result = await getRecentHistory(supabase, user.id, RECENT_LIMIT);
  const showViewAll = result.ok && result.rows.length >= RECENT_LIMIT;

  // Chat-count badges next to each row. Fetch only when history loaded;
  // a counts failure falls back to "no badges" rather than failing the
  // whole page (the badge is a nice-to-have).
  const chatCounts = result.ok
    ? await getChatMessageCounts(
        supabase,
        user.id,
        result.rows.map((row) => row.videoId),
      )
    : new Map<string, number>();

  const fullName = user.user_metadata?.full_name as string | undefined;
  const emailLocal = user.email?.split("@")[0];
  const greetingName = fullName ?? emailLocal ?? "there";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-h2 font-bold text-text-primary">
          Welcome back, {greetingName}
        </h1>
        <p className="text-body-md text-text-secondary">
          Paste a YouTube URL to summarize a new video.
        </p>
      </header>

      <section className="w-full">
        <InputForm />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-h4 font-semibold text-text-primary">Recent</h2>
          {showViewAll ? (
            <Link
              href="/history"
              className="text-body-sm text-text-secondary hover:text-text-primary"
            >
              View all →
            </Link>
          ) : null}
        </div>
        {result.ok ? (
          <HistoryList rows={result.rows} chatCounts={chatCounts} />
        ) : (
          <HistoryFetchError message="Couldn't load your history right now. Please refresh in a moment." />
        )}
      </section>
    </main>
  );
}
