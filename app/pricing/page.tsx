"use client";
import { useState } from "react";
import { PricingFreeCard, PricingProCard } from "./_components/PricingCard";
import { PricingFAQ } from "./_components/PricingFAQ";

export default function PricingPage() {
  const [plan, setPlan] = useState<"monthly" | "yearly">("yearly");
  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-h2 text-text-primary text-center">Simple pricing</h1>
      <p className="mt-2 text-body-md text-text-secondary text-center">
        Start free. Upgrade when you need more.
      </p>

      <div className="mt-6 flex justify-center gap-2" role="radiogroup" aria-label="Billing period">
        <button
          type="button"
          role="radio"
          aria-checked={plan === "yearly"}
          onClick={() => setPlan("yearly")}
          className={`px-4 py-2 rounded-md text-body-sm transition-colors ${
            plan === "yearly"
              ? "bg-accent-brand text-text-inverse"
              : "text-text-secondary hover:bg-state-hover"
          }`}
        >
          Yearly · save 28%
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={plan === "monthly"}
          onClick={() => setPlan("monthly")}
          className={`px-4 py-2 rounded-md text-body-sm transition-colors ${
            plan === "monthly"
              ? "bg-accent-brand text-text-inverse"
              : "text-text-secondary hover:bg-state-hover"
          }`}
        >
          Monthly
        </button>
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <PricingFreeCard />
        <PricingProCard plan={plan} />
      </div>

      <div className="mt-12">
        <PricingFAQ />
      </div>
    </main>
  );
}
