import { YouTubeSummarizerApp } from "@/components/youtube-summarizer-app";

// Mock user for non-authenticated usage
const mockUser = {
  id: "guest",
  email: "guest@youtubeai.chat",
  user_metadata: {
    full_name: "Guest User",
    avatar_url: ""
  }
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
    const params = await searchParams;

  return (
    <YouTubeSummarizerApp initialUrl={params.url} user={mockUser} />
  );
}
