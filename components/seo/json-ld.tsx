// Inline JSON-LD wrapper. Plain `<script>` (not `next/script`) so the
// schema lands in the SSR HTML and non-Google crawlers can read it
// without executing JS.
//
// Escape `<` so a stray `</script>` in any future schema field can't break
// out of the script tag — defense-in-depth, since today's callers pass
// only static project data. This matches Next.js' own `next/script`
// behaviour and Google's Search Central guidance.
export function JsonLd({ data, id }: { data: object; id?: string }) {
  return (
    <script
      id={id}
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
