import {useTranslations} from "next-intl";
import Link from "next/link";

export default function BillingCanceledPage() {
  const t = useTranslations("pricing");
  return (
    <main className="container mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-h2 text-text-primary">{t("noWorries")}</h1>
      <p className="mt-4 text-body-md text-text-secondary">{t("stillFree")}</p>
      <Link
        href="/"
        className="mt-6 inline-block text-accent-brand hover:underline"
      >{t("back")}</Link>
    </main>
  );
}
