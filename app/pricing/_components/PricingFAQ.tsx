const items = [
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel from the Manage subscription page. Pro stays active until the end of your current billing period.",
  },
  {
    q: "What happens at the end of my paid period if I cancel?",
    a: "You're moved back to the Free tier. Your summaries and chat history stay (subject to the Free 10-item history cap).",
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
