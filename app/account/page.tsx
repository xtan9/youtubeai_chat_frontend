import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { AccountView } from "./AccountView";

export const metadata: Metadata = {
  title: "Account - YouTubeAI.chat",
  description: "Manage your YouTubeAI account, plan, and subscription.",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user || (user.is_anonymous ?? false)) {
    redirect("/auth/login");
  }
  return <AccountView />;
}
