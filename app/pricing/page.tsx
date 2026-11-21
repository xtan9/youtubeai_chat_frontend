import {getTranslations} from "next-intl/server";
import type { Metadata } from "next";
import {
  resolvePricingNavigationContext,
  type PricingNavigationContext,
} from "@/lib/analytics/subscription-discovery-navigation";
import { PricingPageContent } from "./_components/PricingPageContent";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pricing");
  const title = t("pageTitle");
  const description = t("pageDescription");
  return {
    title,
    description,
    alternates: { canonical: "/pricing" },
    openGraph: {title, description, url: "/pricing", type: "website"},
    twitter: {card: "summary_large_image", title, description},
  };
}

type PricingPageProps = {
  readonly searchParams: Promise<
    Record<string, string | string[] | undefined>
  >;
};

export default async function PricingPage({
  searchParams,
}: PricingPageProps) {
  const params = await searchParams;
  const initialContext: PricingNavigationContext =
    resolvePricingNavigationContext(params);
  return <PricingPageContent initialContext={initialContext} />;
}
