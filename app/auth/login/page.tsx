import { LoginForm } from "./components/login-form";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login - YouTubeAI.chat",
  description: "Login to access your YouTubeAI account",
  alternates: {
    canonical: "https://www.youtubeai.chat/auth/login",
  },
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
