import { useTranslations } from "next-intl";
import { Suspense } from "react";
import Link from "next/link";
import { FooterPricingLink } from "@/components/footer-pricing-link";

export function Footer() {
  const tr = useTranslations("ui");
  return (
    <footer className="mt-auto hidden w-full border-t bg-surface-base py-6 md:block">
      <div className="container flex flex-col items-center gap-4 px-4 md:px-6">
        <div className="flex flex-col gap-4 text-center md:flex-row md:gap-8">
          <Link
            prefetch={false}
            href="/blog"
            className="text-sm text-text-muted hover:text-text-primary"
          >
            {tr("blog")}
          </Link>
          <Link
            prefetch={false}
            href="/faq"
            className="text-sm text-text-muted hover:text-text-primary"
          >
            {tr("faq")}
          </Link>
          <Suspense fallback={null}>
            <FooterPricingLink />
          </Suspense>
          <Link
            prefetch={false}
            href="/privacy"
            className="text-sm text-text-muted hover:text-text-primary"
          >
            {tr("privacyPolicy")}
          </Link>
          <Link
            prefetch={false}
            href="/terms"
            className="text-sm text-text-muted hover:text-text-primary"
          >
            {tr("termsOfService")}
          </Link>
          <a
            href="mailto:contact@youtubeai.chat"
            className="text-sm text-text-muted hover:text-text-primary"
          >
            {tr("contact")}
          </a>
        </div>
        <div className="flex flex-wrap justify-center gap-4 text-sm text-text-muted">
          <a
            href="https://www.anthropic.com/claude"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text-primary"
          >
            {tr("poweredByClaude")}
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
            {tr("youtubeCaptionsGuide")}
          </a>
        </div>
        <div className="text-sm text-text-muted">
          © {new Date().getFullYear()} YouTube AI Chat. {tr("rights")}
        </div>
      </div>
    </footer>
  );
}
