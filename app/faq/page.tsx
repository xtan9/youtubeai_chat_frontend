import { getTranslations } from "next-intl/server";
import { useLocale, useTranslations } from "next-intl";
import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/json-ld";
import { buildBreadcrumbSchema } from "@/components/seo/breadcrumb-schema";
import { buildFaqPageSchema } from "@/components/seo/faq-page-schema";
import { markdownToPlainText, loadAllFaqEntries, groupFaqByCategory } from "@/lib/content/faq";
import { FaqList } from "./components/faq-list";
import { Breadcrumbs } from "@/app/blog/components/breadcrumbs";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("publicPages");
  return {
    title: t("faqTitle"),
    description:
      "Answers about pricing, accuracy, privacy, supported videos, and how YouTube AI Chat summarizes YouTube videos with AI.",
    alternates: { canonical: "/faq" },
    openGraph: {
      title: "YouTube AI Chat FAQ",
      description:
        "Answers about pricing, accuracy, privacy, and features of YouTube AI Chat.",
      url: "/faq",
      type: "website",
    },
  };
}

export default function FaqPage() {
  const t = useTranslations("publicPages");
  const locale = useLocale();
  const entries = loadAllFaqEntries().map(entry => {
    if (locale === "en") return entry;
    const body = t(`faqAnswers.${entry.slug}`);
    return {...entry, body, question: t(`faqQuestions.${entry.slug}`), answerText: markdownToPlainText(body)};
  });
  const groups = groupFaqByCategory(entries);

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <JsonLd
        id="structured-data-breadcrumb"
        data={buildBreadcrumbSchema([
          { name: t("home"), path: "/" },
          { name: t("faqShort"), path: "/faq" },
        ])}
      />
      <JsonLd id="structured-data-faq-page" data={buildFaqPageSchema(entries)} />

      <Breadcrumbs
        crumbs={[
          { name: t("home"), href: "/" },
          { name: t("faqShort") },
        ]}
      />

      <header className="mb-12">
        <h1 className="text-h1 font-bold text-text-primary tracking-tight mb-4">{t("faq")}</h1>
        <p className="text-body-lg text-text-secondary max-w-2xl">{t("faqIntro")}</p>
      </header>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface-raised p-8 text-center">
          <p className="text-body-md text-text-secondary">{t("faqEmpty")}</p>
        </div>
      ) : (
        <FaqList groups={groups.map(group => ({...group, label: t(`categories.${group.category}`)}))} />
      )}
    </div>
  );
}
