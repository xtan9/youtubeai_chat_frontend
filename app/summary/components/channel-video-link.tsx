"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { buildChannelHubVideoHref } from "@/lib/channel-hub/links";

type OwnedVideoResponse = Readonly<{
  outcome?: string;
  videoId?: unknown;
}>;

export function ChannelVideoLink({
  sourceUrl,
  enabled,
}: Readonly<{
  sourceUrl: string;
  enabled: boolean;
}>) {
  const [resolvedLink, setResolvedLink] = useState<{
    sourceUrl: string;
    href: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!enabled || !sourceUrl) {
      return () => {
        cancelled = true;
      };
    }

    void fetch(`/api/channel/owned-video?url=${encodeURIComponent(sourceUrl)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json().catch(() => null)) as OwnedVideoResponse | null;
      })
      .then((body) => {
        if (cancelled || body?.outcome !== "owned") return;
        const href = buildChannelHubVideoHref(body.videoId);
        if (href) setResolvedLink({ sourceUrl, href });
      })
      .catch(() => {
        // An ownership lookup failure should not create a guessed link.
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, sourceUrl]);

  const href =
    enabled && resolvedLink?.sourceUrl === sourceUrl ? resolvedLink.href : null;

  if (!href) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent-brand/30 bg-accent-brand/5 px-4 py-3 text-body-sm">
      <span className="text-text-secondary">
        This owned Video is available in Channel.
      </span>
      <Link
        href={href}
        className="font-medium text-accent-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-focus"
      >
        Open in Channel Hub
      </Link>
    </div>
  );
}
