"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

const ACCOUNT_ACTIONS = [
  { action: "connect", label: "Connect Channel", variant: "default" },
  { action: "revoke", label: "Revoke Channel authorization", variant: "outline" },
  { action: "disconnect", label: "Disconnect Channel", variant: "outline" },
  { action: "export_data", label: "Export Channel data", variant: "outline" },
  { action: "delete_data", label: "Delete Channel data", variant: "destructive" },
] as const;

type AccountAction = (typeof ACCOUNT_ACTIONS)[number]["action"];

export function ChannelAccountControls({
  releaseStatus,
}: Readonly<{ releaseStatus: "open" | "blocked" }>) {
  const [pendingAction, setPendingAction] = useState<AccountAction | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);

  async function runAction(action: AccountAction) {
    if (pendingAction) return;
    setPendingAction(action);
    setAnnouncement(null);
    try {
      const isConnectAction = action === "connect";
      const response = await fetch(
        isConnectAction ? "/api/channel/oauth/start" : "/api/channel/account",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          ...(isConnectAction ? {} : { body: JSON.stringify({ action }) }),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        message?: string;
        outcome?: string;
      } | null;
      setAnnouncement(
        body?.message ??
          (response.ok
            ? "Channel account control completed."
            : "Channel account control was not completed."),
      );
    } catch {
      setAnnouncement(
        "Channel account control could not be verified. No external or destructive action was made.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <Card aria-labelledby="channel-account-controls-heading">
      <CardHeader className="gap-2">
        <h2
          id="channel-account-controls-heading"
          className="text-h4 font-semibold text-text-primary"
        >
          Channel controls
        </h2>
        {releaseStatus === "blocked" ? (
          <p className="text-body-sm leading-6 text-text-secondary">
            Connection, permission, revocation, export, and deletion controls
            will appear here after the complete Channel launch packet is
            externally verified. No Channel authorization is available yet.
          </p>
        ) : (
          <p className="text-body-sm leading-6 text-text-secondary">
            Account owns this Channel connection and its data lifecycle. These
            controls affect this Channel grant only; they do not sign out or
            revoke your other sessions.
          </p>
        )}
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-4">
        {releaseStatus === "open" ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/channel"
                className="inline-flex h-9 items-center rounded-md bg-surface-inverse px-4 text-sm font-medium text-text-inverse shadow-xs hover:bg-surface-inverse/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-focus"
              >
                Open Channel Hub
              </Link>
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center rounded-md border border-border-default bg-surface-base px-4 text-sm font-medium text-text-primary shadow-xs hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-focus"
              >
                Manage Google permissions
              </a>
            </div>
            <div className="flex flex-wrap gap-2">
              {ACCOUNT_ACTIONS.map(({ action, label, variant }) => (
                <Button
                  key={action}
                  type="button"
                  variant={variant}
                  onClick={() => void runAction(action)}
                  disabled={pendingAction !== null}
                >
                  {pendingAction === action ? `${label}…` : label}
                </Button>
              ))}
            </div>
            <p className="max-w-prose text-caption leading-5 text-text-muted">
              Connect and Channel Hub work require an active Pro entitlement.
              A failed provider or cleanup operation is reported as incomplete
              so you can retry or use the provider&apos;s native permissions page.
            </p>
          </>
        ) : null}
        {announcement ? (
          <p role="status" aria-live="polite" className="text-body-sm text-text-secondary">
            {announcement}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
