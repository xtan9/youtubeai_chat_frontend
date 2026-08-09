import type { Metadata } from "next";
import {
  resolvePricingNavigationContext,
  type PricingNavigationContext,
} from "@/lib/analytics/subscription-discovery-navigation";
import { PricingPlans, type PricingContext } from "./_components/PricingPlans";
import { PricingFAQ } from "./_components/PricingFAQ";

const description =
  "Compare the Free Plan with the Pro Plan at $6.99 monthly or a $4.99 monthly equivalent billed as $59.88 annually.";

export const metadata: Metadata = {
  title: "Pricing | YouTube AI Chat",
  description,
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing | YouTube AI Chat",
    description,
    url: "/pricing",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pricing | YouTube AI Chat",
    description,
  },
};

export function PricingPageContent({
  initialContext,
}: {
  readonly initialContext: PricingContext;
}) {
  return (
    <main className="container mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-h2 text-text-primary text-center">Simple pricing</h1>
      <p className="mt-2 text-body-md text-text-secondary text-center">
        Start free. Upgrade when you need more.
      </p>

      <PricingPlans initialContext={initialContext} />

      <div className="mt-12">
        <PricingFAQ />
      </div>
    </main>
  );
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
