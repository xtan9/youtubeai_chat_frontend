import { YouTubeSummarizerApp } from "@/components/youtube-summarizer-app";
import { createClient } from "@/lib/supabase/server";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  const params = await searchParams;
  
  // Get the authenticated user
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  // Use authenticated user if available, otherwise create a simple guest user
  const currentUser = user || { id: "guest" };

  return (
    <YouTubeSummarizerApp initialUrl={params.url} user={currentUser} />
  );
}
