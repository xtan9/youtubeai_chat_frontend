"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ChannelHubExperience } from "@/components/channel/channel-hub-experience";
import type { ChannelHubState, HubAction } from "@/lib/channel-hub/contract";

export function ChannelHubController({
  state,
  filterVideoId,
}: Readonly<{
  state: ChannelHubState;
  filterVideoId?: string | null;
}>) {
  const router = useRouter();
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<HubAction | null>(null);

  async function handleAction(action: HubAction, subjectId?: string) {
    if (action === "upgrade") return;
    setPendingAction(action);
    setAnnouncement(null);
    try {
      const isOAuthAction =
        action === "connect" || action === "continue_onboarding";
      const response = await fetch(
        isOAuthAction ? "/api/channel/oauth/start" : "/api/channel/actions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          ...(isOAuthAction
            ? {}
            : { body: JSON.stringify({ action, subjectId: subjectId ?? null }) }),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        outcome?: string;
        message?: string;
        authorizationUrl?: unknown;
      } | null;
      if (
        response.ok &&
        body?.outcome === "accepted" &&
        typeof body.authorizationUrl === "string"
      ) {
        window.location.assign(body.authorizationUrl);
      } else if (response.ok && body?.outcome === "accepted") {
        setAnnouncement("Channel action accepted. Refreshing the Hub.");
        router.refresh();
      } else {
        setAnnouncement(
          body?.message ??
            "Channel action was not started. Your Channel authority was rechecked and no external action was made.",
        );
      }
    } catch {
      setAnnouncement(
        "Channel action could not be verified. No external action was made.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <>
      {filterVideoId ? (
        <div
          className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 rounded-xl border border-accent-brand/30 bg-accent-brand/10 px-4 py-3 text-body-sm text-text-secondary sm:px-6"
          data-channel-video-filter={filterVideoId}
          role="status"
        >
          <span>
            Showing Channel activity for the owned Video selected from your
            summaries.
          </span>
          <Link
            href="/channel"
            className="shrink-0 font-medium text-accent-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-focus"
          >
            Clear filter
          </Link>
        </div>
      ) : null}
      <ChannelHubExperience
        state={state}
        mode="release"
        onAction={(action, subjectId) => void handleAction(action, subjectId)}
      />
      {announcement ? (
        <p
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {announcement}
        </p>
      ) : null}
      {pendingAction ? (
        <span className="sr-only" aria-busy="true">
          {pendingAction.replaceAll("_", " ")} in progress
        </span>
      ) : null}
    </>
  );
}
