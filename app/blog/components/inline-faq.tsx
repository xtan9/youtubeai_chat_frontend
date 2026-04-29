// The FAQPage JSON-LD on the post page consumes the same `items` array.
export function InlineFaq({
  items,
}: {
  items: { q: string; a: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="my-12 max-w-3xl mx-auto">
      <h2 className="text-h2 font-bold text-text-primary mb-6 scroll-mt-24" id="faq">
        Frequently asked questions
      </h2>
      <div className="space-y-4">
        {items.map((item, idx) => (
          <div
            key={`${idx}-${item.q}`}
            className="rounded-xl border border-border-subtle bg-surface-raised p-5"
          >
            <h3 className="text-h5 font-semibold text-text-primary mb-2">
              {item.q}
            </h3>
            <p className="text-body-md text-text-secondary leading-relaxed">
              {item.a}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
