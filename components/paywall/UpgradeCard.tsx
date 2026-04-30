import Link from "next/link";
import { Button } from "@/components/ui/button";

type Variant = "summary-cap" | "chat-cap" | "history-cap";

const COPY: Record<Variant, { title: string; body: string; reset?: string }> = {
  "summary-cap": {
    title: "You've used your 10 free summaries this month.",
    body: "Upgrade to Pro for unlimited summaries, chat, and history.",
    reset: "Resets on the 1st.",
  },
  "chat-cap": {
    title: "You've used your 5 free chat messages on this video.",
    body: "Upgrade to Pro for unlimited chat across every video.",
  },
  "history-cap": {
    title: "Showing 10 of 10 — older summaries auto-replaced.",
    body: "Upgrade for unlimited history.",
  },
};

export function UpgradeCard({ variant }: { variant: Variant }) {
  const copy = COPY[variant];
  return (
    <section
      className="rounded-2xl bg-surface-raised border border-border-subtle p-6 text-center"
      data-paywall-variant={variant}
    >
      <h2 className="text-h4 text-text-primary">{copy.title}</h2>
      <p className="mt-2 text-body-md text-text-secondary">{copy.body}</p>
      <div className="mt-4 flex justify-center gap-2">
        <Link href="/pricing">
          <Button>Upgrade — $4.99/mo</Button>
        </Link>
        <Link href="/pricing">
          <Button variant="outline">See plans</Button>
        </Link>
      </div>
      {copy.reset ? (
        <p className="mt-3 text-caption text-text-muted">{copy.reset}</p>
      ) : null}
    </section>
  );
}
