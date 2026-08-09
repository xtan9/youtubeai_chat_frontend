import Link from "next/link";

const items = [
  {
    q: "What is included in each plan?",
    a: (
      <>
        The Free Plan includes 10 summaries per month, 5 Video Chat messages
        per Video, a 10-item History, and 1 durable Project. The Pro Plan
        includes unlimited summaries, Video Chat, History, and Projects within
        technical and abuse limits for $6.99 per month, or a $4.99 per month
        equivalent billed as $59.88 annually.
      </>
    ),
  },
  {
    q: "Can I cancel anytime?",
    a: (
      <>
        Yes. Open{" "}
        <Link
          href="/account/billing"
          className="text-accent-brand underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-brand"
        >
          Plan &amp; Billing
        </Link>{" "}
        and choose Manage subscription to open the Stripe Customer Portal.
        Cancel there; the Pro Plan stays active until the end of your current
        billing period.
      </>
    ),
  },
  {
    q: "What happens at the end of my paid period if I cancel?",
    a: "You're moved back to the Free Plan. Your summaries and Video Chat history stay, subject to the Free Plan's 10-item History limit.",
  },
  {
    q: "Do you offer refunds?",
    a: "We don't process automatic refunds, but reach out — we'll handle exceptions case-by-case.",
  },
  {
    q: "What payment methods do you accept?",
    a: "All major credit and debit cards via Stripe.",
  },
];

export function PricingFAQ() {
  return (
    <section className="space-y-4">
      <h2 className="text-h4 text-text-primary">Common questions</h2>
      {items.map((it) => (
        <details
          key={it.q}
          className="rounded-lg border border-border-subtle bg-surface-raised p-4"
        >
          <summary className="text-body-md text-text-primary cursor-pointer">
            {it.q}
          </summary>
          <p className="mt-2 text-body-sm text-text-secondary">{it.a}</p>
        </details>
      ))}
    </section>
  );
}
