import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getRecentHistory } from "@/lib/services/user-history";
import { InputForm } from "@/app/components/input-form";
import { HistoryList } from "@/app/components/history/history-list";

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
  if (!user) redirect("/auth/login");

  const rows = await getRecentHistory(supabase, user.id, RECENT_LIMIT);
  const showViewAll = rows.length >= RECENT_LIMIT;

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
        <HistoryList rows={rows} />
      </section>
    </main>
  );
}
