import { PricingFreeCard, PricingProCard } from "./_components/PricingCard";
import { PricingFAQ } from "./_components/PricingFAQ";

export default function PricingPage() {
  return (
    <main className="container mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-h2 text-text-primary text-center">Simple pricing</h1>
      <p className="mt-2 text-body-md text-text-secondary text-center">
        Start free. Upgrade when you need more.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <PricingFreeCard />
        <PricingProCard plan="monthly" />
        <PricingProCard plan="yearly" />
      </div>

      <div className="mt-12">
        <PricingFAQ />
      </div>
    </main>
  );
}
