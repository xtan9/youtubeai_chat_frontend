import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/json-ld";
import { buildBreadcrumbSchema } from "@/components/seo/breadcrumb-schema";
import { buildWebPageSchema } from "@/components/seo/webpage-schema";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("publicPages");
  return {
    title: t("privacyTitle"),
    description: t("privacyTitleDesc"),
    alternates: {
      canonical: "/privacy",
    },
  };
}

export default function PrivacyPolicy() {
  const t = useTranslations("publicPages");
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <JsonLd
        id="structured-data-breadcrumb"
        data={buildBreadcrumbSchema([
          { name: t("home"), path: "/" },
          { name: t("privacy"), path: "/privacy" },
        ])}
      />
      <JsonLd
        id="structured-data-webpage"
        data={buildWebPageSchema({
          name: t("privacy"),
          description:
            t("privacyTitleDesc"),
          path: "/privacy",
        })}
      />
      <h1 className="text-3xl font-bold mb-8">{t("privacy")}</h1>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">{t("intro")}</h2>
        <p className="mb-4">{t("introText")}</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">{t("collection")}</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>{t("accountData")}</li>
          <li>{t("usageData")}</li>
          <li>{t("urls")}</li>
          <li>{t("generated")}</li>
          <li>{t("technical")}</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">{t("use")}</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>{t("improve")}</li>
          <li>{t("personalize")}</li>
          <li>{t("communicate")}</li>
          <li>{t("analyze")}</li>
          <li>{t("protect")}</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">{t("storage")}</h2>
        <p className="mb-4">{t("storageText")}</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">{t("third")}</h2>
        <p className="mb-4">{t("thirdText")}</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>{t("auth")}</li>
          <li>{t("analytics")}</li>
          <li>{t("video")}</li>
        </ul>
        <p className="mt-4">{t("thirdPolicies")}</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">{t("highlight")}</h2>
        <p className="mb-4">{t("highlightText")}</p>
        <p className="mb-4">{t("highlightPrefs")}</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">{t("rights")}</h2>
        <p className="mb-4">{t("rightsText")}</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>{t("accessData")}</li>
          <li>{t("correct")}</li>
          <li>{t("delete")}</li>
          <li>{t("object")}</li>
          <li>{t("withdraw")}</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">{t("privacyContact")}</h2>
        <p className="mb-4">{t("privacyContactText")}</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">{t("policyChanges")}</h2>
        <p className="mb-4">{t("policyChangesText")}</p>
      </section>

      <footer className="text-sm text-text-muted">
        {t("lastUpdated")} <time dateTime="2026-10-18">{t("privacyDate")}</time>
      </footer>
    </div>
  );
}
