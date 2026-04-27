import { SignUpForm } from "./components/sign-up-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign Up - YouTubeAI.chat",
  description:
    "Create a free YouTubeAI account to save and revisit your AI-generated YouTube video summaries.",
  alternates: {
    canonical: "/auth/sign-up",
  },
};

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <SignUpForm />
      </div>
    </div>
  );
}
