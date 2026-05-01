"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ManageSubscriptionButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      if (!res.ok) {
        console.error("[paywall] portal request failed", { status: res.status });
        setError("Couldn't open the billing portal. Please try again.");
        setPending(false);
        return;
      }
      const body = (await res.json()) as { url?: string };
      if (!body.url) {
        console.error("[paywall] portal response missing url");
        setError("Couldn't open the billing portal. Please try again.");
        setPending(false);
        return;
      }
      window.location.assign(body.url);
    } catch (err) {
      console.error("[paywall] portal navigation threw", err);
      setError("Couldn't open the billing portal. Please try again.");
      setPending(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        onClick={onClick}
        disabled={pending}
        data-paywall-action="manage-subscription"
      >
        {pending ? "Opening…" : "Manage subscription"}
      </Button>
      {error ? (
        <p className="text-caption text-accent-danger mt-2" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
