import Link from "next/link";

type HistoryPaginationProps = {
  current: number;
  totalPages: number;
};

export function HistoryPagination({
  current,
  totalPages,
}: HistoryPaginationProps) {
  if (totalPages <= 1) return null;
  const prev = current > 1 ? current - 1 : null;
  const next = current < totalPages ? current + 1 : null;

  return (
    <nav
      aria-label="History pagination"
      className="flex items-center justify-between gap-3"
    >
      {prev !== null ? (
        <Link
          href={`/history?page=${prev}`}
          className="text-body-sm text-text-secondary hover:text-text-primary"
          rel="prev"
        >
          ← Previous
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      <span className="text-caption text-text-muted">
        Page {current} of {totalPages}
      </span>
      {next !== null ? (
        <Link
          href={`/history?page=${next}`}
          className="text-body-sm text-text-secondary hover:text-text-primary"
          rel="next"
        >
          Next →
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
    </nav>
  );
}
