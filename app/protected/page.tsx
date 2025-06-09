import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { YouTubeSummarizerApp } from "@/components/youtube-summarizer-app";

export default async function ProtectedPage({
  searchParams,
}: {
  searchParams: { url?: string };
}) {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    redirect("/auth/login");
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <YouTubeSummarizerApp initialUrl={searchParams.url} user={data.user} />
    </div>
  );
}
