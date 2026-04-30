import Link from "next/link";

export function HistoryFreeBanner({
  used,
  limit,
}: {
  used: number;
  limit: number;
}) {
  const atCap = used >= limit;
  return (
    <p
      className="text-body-sm text-text-secondary"
      data-paywall-variant="history-free-banner"
    >
      Showing {Math.min(used, limit)} of {limit} —{" "}
      {atCap ? "older summaries auto-replaced. " : null}
      <Link href="/pricing" className="text-accent-brand hover:underline">
        Upgrade for unlimited history
      </Link>
    </p>
  );
}
