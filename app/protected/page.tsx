import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { YouTubeSummarizerApp } from "@/components/youtube-summarizer-app";

export default async function ProtectedPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    redirect("/auth/login");
  }

  const params = await searchParams;

  return (
    <YouTubeSummarizerApp initialUrl={params.url} user={data.user} />
  );
}
