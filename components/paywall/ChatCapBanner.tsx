import Link from "next/link";
import { Button } from "@/components/ui/button";

type Variant = "free-cap" | "anon-blocked";

const COPY: Record<Variant, { message: string; cta: string }> = {
  "free-cap": {
    message: "You've used 5/5 free chat messages on this video.",
    cta: "Upgrade for unlimited chat — $4.99/mo",
  },
  "anon-blocked": {
    message: "Sign up to chat about your videos.",
    cta: "Sign up free",
  },
};

export function ChatCapBanner({ variant = "free-cap" }: { variant?: Variant }) {
  const copy = COPY[variant];
  // anon-blocked CTA goes to signup; free-cap goes to /pricing
  const href = variant === "anon-blocked" ? "/auth/sign-up" : "/pricing";
  return (
    <div
      className="rounded-lg border border-border-subtle bg-surface-raised p-4 text-center"
      data-paywall-variant={`chat-${variant}`}
    >
      <p className="text-body-md text-text-primary">{copy.message}</p>
      <Link href={href} className="mt-2 inline-block">
        <Button size="sm">{copy.cta}</Button>
      </Link>
    </div>
  );
}
