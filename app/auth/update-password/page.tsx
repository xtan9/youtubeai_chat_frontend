import { UpdatePasswordForm } from "./components/update-password-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Update Password - YouTubeAI.chat",
  description: "Set a new password for your YouTubeAI account.",
  // Auth pages don't belong in the index — Disallow in robots.txt only
  // suppresses crawling, not indexing of externally-linked URLs.
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <UpdatePasswordForm />
      </div>
    </div>
  );
}
