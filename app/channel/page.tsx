import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ChannelHubController } from "./channel-hub-controller";
import { ChannelReleaseBlocked } from "./channel-release-blocked";
import { ChannelUnavailable } from "./channel-unavailable";
import { evaluateChannelLaunchGate } from "@/lib/compliance/channel-launch";
import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { createClient } from "@/lib/supabase/server";
import { resolveRegisteredSubscription } from "@/lib/services/entitlements";
import {
  loadChannelAccessSnapshot,
  loadConnectedChannelHubState,
  loadOwnedVideoFilter,
} from "@/lib/channel-exposure/server";
import { resolveChannelExposure } from "@/lib/channel-exposure/eligibility";
import type { ChannelEntitlement } from "@/lib/channel-onboarding/access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Channel Hub - YouTube AI Chat",
  description:
    "Review bounded interactions for your account-owned YouTube Channel.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{
  videoId?: string;
}>;

function entitlementFromSubscription(
  subscription: Extract<
    Awaited<ReturnType<typeof resolveRegisteredSubscription>>,
    { kind: "resolved" }
  >,
): ChannelEntitlement {
  return {
    state: subscription.presentation.state,
    verified: true,
  };
}

export default async function ChannelPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const launchGate = evaluateChannelLaunchGate();
  if (launchGate.status === "blocked") {
    return <ChannelReleaseBlocked gate={launchGate} />;
  }

  const principalResult = await resolveRequestPrincipal({
    source: "channel_hub",
  });
  if (principalResult.kind === "unavailable") {
    throw new Error("Auth service temporarily unavailable.");
  }
  if (
    principalResult.kind === "missing" ||
    principalResult.principal.isAnonymous
  ) {
    redirect("/auth/login");
  }

  const principal = principalResult.principal;
  const subscription = await resolveRegisteredSubscription(
    principal.userId,
    principal.smokeProEntitled === true,
  );
  if (subscription.kind === "unavailable") return <ChannelUnavailable />;

  const entitlement = entitlementFromSubscription(subscription);
  const supabase = await createClient();
  const accessResult = await loadChannelAccessSnapshot({
    supabase,
    userId: principal.userId,
    entitlement,
  });
  if (accessResult.kind === "unavailable") return <ChannelUnavailable />;

  const exposure = resolveChannelExposure({
    launchGate,
    access: accessResult.snapshot.access,
  });
  if (exposure.kind === "blocked") return <ChannelUnavailable />;
  if (exposure.kind === "free_discovery" || exposure.kind === "pro_onboarding") {
    return <ChannelHubController state={exposure.state} />;
  }

  const params = await searchParams;
  const ownedFilter = await loadOwnedVideoFilter({
    supabase,
    userId: principal.userId,
    requestedVideoId: params.videoId,
  });
  if (ownedFilter.kind === "unavailable") return <ChannelUnavailable />;

  const state = await loadConnectedChannelHubState({
    accountId: principal.userId,
    details: accessResult.snapshot.channel!,
    grant: accessResult.snapshot.access.grant!,
    providerVideoId:
      ownedFilter.kind === "resolved" ? ownedFilter.providerVideoId : null,
  });
  if (!state) return <ChannelUnavailable />;

  return (
    <ChannelHubController
      state={state}
      filterVideoId={
        ownedFilter.kind === "resolved"
          ? ownedFilter.internalVideoId
          : undefined
      }
    />
  );
}
