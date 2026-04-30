"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

type Reason = "hit-cap" | "feature-locked";

const COPY: Record<Reason, string> = {
  "hit-cap":
    "Try unlimited free — sign up to get 10 free summaries per month and our AI chat.",
  "feature-locked":
    "Sign up to keep using the app — get 10 free summaries each month.",
};

export function AnonSignupWall({ reason = "hit-cap" }: { reason?: Reason }) {
  return (
    <section
      className="rounded-2xl bg-surface-raised border border-border-subtle p-6 text-center"
      data-paywall-variant={`anon-${reason}`}
    >
      <p className="text-body-md text-text-primary">{COPY[reason]}</p>
      <div className="mt-4 flex justify-center gap-2">
        <Link href="/auth/sign-up?redirect_to=/">
          <Button>Sign up free</Button>
        </Link>
        <Link href="/auth/login?redirect_to=/">
          <Button variant="outline">I have an account</Button>
        </Link>
      </div>
    </section>
  );
}
