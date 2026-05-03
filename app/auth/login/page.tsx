import { LoginForm } from "./components/login-form";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login - YouTube AI Chat",
  description: "Login to access your YouTube AI Chat account",
  alternates: {
    canonical: "https://www.youtubeai.chat/auth/login",
  },
  // Auth pages don't belong in the index — Disallow in robots.txt only
  // suppresses crawling, not indexing of externally-linked URLs.
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </div>
  );
}
