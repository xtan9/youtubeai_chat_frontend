import Link from "next/link";

export default function BillingCanceledPage() {
  return (
    <main className="container mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-h2 text-text-primary">No worries</h1>
      <p className="mt-4 text-body-md text-text-secondary">
        You&apos;re still on the free tier.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block text-accent-brand hover:underline"
      >
        Back to summaries
      </Link>
    </main>
  );
}
