import Link from "next/link";
import { ChevronRight } from "lucide-react";

// Visible breadcrumb trail. JSON-LD BreadcrumbList is emitted separately
// on each page; this is the human-visible counterpart.
export function Breadcrumbs({
  crumbs,
}: {
  crumbs: { name: string; href?: string }[];
}) {
  return (
    <nav aria-label="Breadcrumb" className="text-body-sm text-text-muted mb-6">
      <ol className="flex items-center flex-wrap gap-1">
        {crumbs.map((c, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={14} className="text-text-muted" />}
            {c.href && i < crumbs.length - 1 ? (
              <Link
                href={c.href}
                className="hover:text-text-primary transition-colors"
              >
                {c.name}
              </Link>
            ) : (
              <span className="text-text-primary font-medium">{c.name}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
