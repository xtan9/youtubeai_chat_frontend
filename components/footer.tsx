import Link from "next/link";

export function Footer() {
  return (
    <footer className="w-full border-t bg-surface-base py-6 mt-auto">
      <div className="container flex flex-col items-center gap-4 px-4 md:px-6">
        <div className="flex flex-col gap-4 text-center md:flex-row md:gap-8">
          <Link
            href="/blog"
            className="text-sm text-text-muted hover:text-text-primary"
          >
            Blog
          </Link>
          <Link
            href="/faq"
            className="text-sm text-text-muted hover:text-text-primary"
          >
            FAQ
          </Link>
          <Link
            href="/privacy"
            className="text-sm text-text-muted hover:text-text-primary"
          >
            Privacy Policy
          </Link>
          <Link
            href="/terms"
            className="text-sm text-text-muted hover:text-text-primary"
          >
            Terms of Service
          </Link>
          <a
            href="mailto:contact@youtubeai.chat"
            className="text-sm text-text-muted hover:text-text-primary"
          >
            Contact
          </a>
        </div>
        <div className="flex flex-wrap justify-center gap-4 text-sm text-text-muted">
          <a
            href="https://www.anthropic.com/claude"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text-primary"
          >
            Powered by Claude
          </a>
          <a
            href="https://openai.com/research/whisper"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text-primary"
          >
            OpenAI Whisper
          </a>
          <a
            href="https://support.google.com/youtube/answer/2734796"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text-primary"
          >
            YouTube captions guide
          </a>
        </div>
        <div className="text-sm text-text-muted">
          © {new Date().getFullYear()} YouTubeAI.chat. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
