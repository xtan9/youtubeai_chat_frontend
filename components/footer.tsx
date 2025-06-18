import Link from "next/link";

export function Footer() {
  return (
    <footer className="w-full border-t bg-background py-6 mt-auto">
      <div className="container flex flex-col items-center gap-4 px-4 md:px-6">
        <div className="flex flex-col gap-4 text-center md:flex-row md:gap-8">
          <Link
            href="/privacy"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Privacy Policy
          </Link>
          <Link
            href="/terms"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Terms of Service
          </Link>
        </div>
        <div className="flex flex-wrap justify-center gap-4 text-sm text-muted-foreground">
          <a
            href="https://www.youtube.com/creators/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
          >
            YouTube Creator Academy
          </a>
          <a
            href="https://openai.com/research/gpt-4"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
          >
            Learn about GPT-4
          </a>
          <a
            href="https://www.deeplearning.ai/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
          >
            DeepLearning.AI
          </a>
          <a
            href="https://www.coursera.org/courses?query=video%20editing"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
          >
            Video Editing Courses
          </a>
        </div>
        <div className="text-sm text-muted-foreground">
          © {new Date().getFullYear()} YouTubeAI.chat. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
