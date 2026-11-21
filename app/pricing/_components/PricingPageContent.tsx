import {useTranslations} from "next-intl";
import { PricingPlans, type PricingContext } from "./PricingPlans";
import { PricingFAQ } from "./PricingFAQ";

export function PricingPageContent({
  initialContext,
}: {
  readonly initialContext: PricingContext;
}) {
  const t = useTranslations("pricing");
  return (
    <main className="container mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-h2 text-text-primary text-center">{t("headline")}</h1>
      <p className="mt-2 text-body-md text-text-secondary text-center">{t("intro")}</p>

      <PricingPlans initialContext={initialContext} />

      <div className="mt-12">
        <PricingFAQ />
      </div>
    </main>
  );
}
