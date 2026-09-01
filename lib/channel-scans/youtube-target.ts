import "server-only";

import { getServiceRoleClient } from "@/lib/supabase/service-role";
import {
  YouTubeScanTargetSchema,
  type YouTubeScanTarget,
} from "./youtube-provider";

export class YouTubeScanTargetUnavailableError extends Error {
  constructor(message = "The verified YouTube scan target is unavailable.") {
    super(message);
    this.name = "YouTubeScanTargetUnavailableError";
  }
}

/**
 * Resolve the scan target from the account-owned onboarding records. The
 * worker never accepts a provider channel ID supplied by the browser, and
 * this RPC returns no access or refresh token.
 */
export async function resolveYouTubeScanTarget(input: Readonly<{
  accountId: string;
  connectedChannelId: string;
}>): Promise<YouTubeScanTarget | null> {
  const service = getServiceRoleClient();
  if (!service) return null;

  const result = await service.rpc("resolve_channel_scan_target", {
    p_account_id: input.accountId,
    p_connected_channel_id: input.connectedChannelId,
  });
  if (result.error) {
    throw new YouTubeScanTargetUnavailableError();
  }
  if (result.data === null) return null;

  const parsed = YouTubeScanTargetSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new YouTubeScanTargetUnavailableError();
  }
  return parsed.data;
}
