"use client";

import {useTranslations} from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ManageSubscriptionButton({
  label,
  onActivate,
}: {
  label?: string;
  onActivate?: () => void;
}) {
  const t = useTranslations("pricing");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  const onClick = async () => {
    onActivate?.();
    setError(false);
    setPending(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      if (!res.ok) {
        console.error("[paywall] portal request failed", { status: res.status });
        setError(true);
        setPending(false);
        return;
      }
      const body = (await res.json()) as { url?: string };
      if (!body.url) {
        console.error("[paywall] portal response missing url");
        setError(true);
        setPending(false);
        return;
      }
      window.location.assign(body.url);
    } catch (err) {
      console.error("[paywall] portal navigation threw", err);
      setError(true);
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
        {pending ? t("opening") : (label ?? t("manage"))}
      </Button>
      {error ? (
        <p className="text-caption text-accent-danger mt-2" role="alert">
          {t("portalError")}
        </p>
      ) : null}
    </>
  );
}
