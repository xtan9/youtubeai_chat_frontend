import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/json-ld";
import { buildBreadcrumbSchema } from "@/components/seo/breadcrumb-schema";
import { buildFaqPageSchema } from "@/components/seo/faq-page-schema";
import { loadAllFaqEntries, groupFaqByCategory } from "@/lib/content/faq";
import { FaqList } from "./components/faq-list";
import { Breadcrumbs } from "@/app/blog/components/breadcrumbs";

export const metadata: Metadata = {
  title: "Frequently Asked Questions | YouTubeAI",
  description:
    "Answers about pricing, accuracy, privacy, supported videos, and how YouTubeAI summarizes YouTube videos with AI.",
  alternates: { canonical: "/faq" },
  openGraph: {
    title: "YouTubeAI FAQ",
    description:
      "Answers about pricing, accuracy, privacy, and features of YouTubeAI.",
    url: "/faq",
    type: "website",
  },
};

export default function FaqPage() {
  const entries = loadAllFaqEntries();
  const groups = groupFaqByCategory(entries);

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <JsonLd
        id="structured-data-breadcrumb"
        data={buildBreadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "FAQ", path: "/faq" },
        ])}
      />
      <JsonLd id="structured-data-faq-page" data={buildFaqPageSchema(entries)} />

      <Breadcrumbs
        crumbs={[
          { name: "Home", href: "/" },
          { name: "FAQ" },
        ]}
      />

      <header className="mb-12">
        <h1 className="text-h1 font-bold text-text-primary tracking-tight mb-4">
          Frequently asked questions
        </h1>
        <p className="text-body-lg text-text-secondary max-w-2xl">
          Quick answers about how YouTubeAI works, what it costs, what videos
          it supports, and how your data is handled.
        </p>
      </header>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface-raised p-8 text-center">
          <p className="text-body-md text-text-secondary">
            No FAQ entries yet.
          </p>
        </div>
      ) : (
        <FaqList groups={groups} />
      )}
    </div>
  );
}
