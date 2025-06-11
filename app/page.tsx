import { redirect } from "next/navigation";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  const params = await searchParams;
  
  // If there's a URL parameter, redirect to /summary with it
  if (params.url) {
    redirect(`/summary?url=${encodeURIComponent(params.url)}`);
  } else {
    redirect("/summary");
  }
}
