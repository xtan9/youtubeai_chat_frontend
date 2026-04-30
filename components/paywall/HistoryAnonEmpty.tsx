import Link from "next/link";
import { Button } from "@/components/ui/button";

export function HistoryAnonEmpty() {
  return (
    <section
      className="rounded-2xl bg-surface-raised border border-border-subtle p-12 text-center"
      data-paywall-variant="history-anon"
    >
      <h2 className="text-h3 text-text-primary">
        Save and revisit your summaries.
      </h2>
      <p className="mt-2 text-body-md text-text-secondary">
        Sign up to keep a history of every video you&apos;ve summarized.
      </p>
      <Link
        href="/auth/sign-up?redirect_to=/history"
        className="mt-4 inline-block"
      >
        <Button>Sign up free</Button>
      </Link>
    </section>
  );
}
