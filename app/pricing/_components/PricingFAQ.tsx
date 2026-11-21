import {useTranslations} from "next-intl";
import Link from "next/link";

export function PricingFAQ() {
  const t = useTranslations("pricing");
  return (
    <section className="space-y-4">
      <h2 className="text-h4 text-text-primary">{t("faqTitle")}</h2>
      {(["included", "cancellation", "downgrade", "refunds", "payment"] as const).map((id) => (
        <details
          key={id}
          className="rounded-lg border border-border-subtle bg-surface-raised p-4"
        >
          <summary className="text-body-md text-text-primary cursor-pointer">
            {t(`${id}Q`)}
          </summary>
          <p className="mt-2 text-body-sm text-text-secondary">{id === "cancellation" ? t.rich("cancellationA", {
            billing: (label) => <Link href="/account/billing" className="text-accent-brand underline underline-offset-2 hover:no-underline">{label}</Link>,
          }) : t(`${id}A`)}</p>
        </details>
      ))}
    </section>
  );
}
