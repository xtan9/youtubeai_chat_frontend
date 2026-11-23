import { useTranslations } from "next-intl";
import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";

// Links to /summary?url=<heroVideo> so the CTA runs against the post's exact video.
export function CtaCard({
  videoUrl,
  videoTitle,
}: {
  videoUrl: string;
  videoTitle: string;
}) {
  const t = useTranslations("publicPages");
  const href = `/summary?url=${encodeURIComponent(videoUrl)}`;
  return (
    <aside className="not-prose my-10 rounded-2xl bg-gradient-brand-soft border border-border-subtle p-6 md:p-8">
      <div className="flex items-start gap-4">
        <div className="hidden sm:flex shrink-0 w-12 h-12 rounded-xl bg-gradient-brand-primary items-center justify-center">
          <Sparkles className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-caption uppercase tracking-wider text-text-muted mb-1">{t("try")}</p>
          <h3 className="text-h4 font-semibold text-text-primary mb-2">
            {t("ctaVideo", {title: videoTitle})}
          </h3>
          <p className="text-body-sm text-text-secondary mb-4">{t("ctaDesc")}</p>
          <Link
            href={href}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-brand-primary hover:bg-gradient-brand-primary-hover text-white font-medium text-body-sm transition-colors"
          >{t("cta")}<ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </aside>
  );
}
