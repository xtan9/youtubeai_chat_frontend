import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/json-ld";
import { buildBreadcrumbSchema } from "@/components/seo/breadcrumb-schema";
import { buildWebPageSchema } from "@/components/seo/webpage-schema";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("publicPages");
  return {
    title: t("termsTitle"),
    description: t("termsTitleDesc"),
    alternates: {
      canonical: "/terms",
    },
  };
}

export default function TermsOfService() {
  const t = useTranslations("publicPages");
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <JsonLd
        id="structured-data-breadcrumb"
        data={buildBreadcrumbSchema([
          { name: t("home"), path: "/" },
          { name: t("terms"), path: "/terms" },
        ])}
      />
      <JsonLd
        id="structured-data-webpage"
        data={buildWebPageSchema({
          name: t("terms"),
          description:
            t("termsTitleDesc"),
          path: "/terms",
        })}
      />
      <h1 className="text-3xl font-bold mb-8">{t("terms")}</h1>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">{t("accept")}</h2>
        <p className="mb-4">{t("acceptText")}</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">{t("service")}</h2>
        <p className="mb-4">{t("serviceText")}</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">{t("duties")}</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>{t("accurate")}</li>
          <li>{t("secure")}</li>
          <li>{t("authorized")}</li>
          <li>{t("laws")}</li>
          <li>{t("youtube")}</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">{t("ip")}</h2>
        <p className="mb-4">{t("ipText")}</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">{t("limits")}</h2>
        <p className="mb-4">{t("limitsText")}</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>{t("unlawful")}</li>
          <li>{t("access")}</li>
          <li>{t("disrupt")}</li>
          <li>{t("track")}</li>
          <li>{t("spam")}</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">{t("warranty")}</h2>
        <p className="mb-4">{t("warrantyText")}</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">{t("liability")}</h2>
        <p className="mb-4">{t("liabilityText")}</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">{t("changes")}</h2>
        <p className="mb-4">{t("changesText")}</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">{t("jurisdiction")}</h2>
        <p className="mb-4">{t("jurisdictionText")}</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">{t("contact")}</h2>
        <p className="mb-4">{t("contactText")}</p>
      </section>

      <footer className="text-sm text-text-muted">
        {t("lastUpdated")} <time dateTime="2026-05-03">{t("termsDate")}</time>
      </footer>
    </div>
  );
}
