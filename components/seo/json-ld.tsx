// Inline JSON-LD wrapper. Plain `<script>` (not `next/script`) so the
// schema lands in the SSR HTML and non-Google crawlers can read it
// without executing JS. Keep small — `dangerouslySetInnerHTML` is safe
// here only because every caller passes a fixed-shape object derived from
// static project data, never user input.
export function JsonLd({ data, id }: { data: object; id?: string }) {
  return (
    <script
      id={id}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
