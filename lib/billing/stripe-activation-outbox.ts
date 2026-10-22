import type { User } from "@supabase/supabase-js";
import {
  captureSubscriptionActivated,
  type SubscriptionActivationCaptureStatus,
} from "@/lib/analytics/server";
import {
  type ServiceClient,
  readWebhookMarker,
  insertWebhookMarker,
  claimLeasedWebhookMarker,
} from "./stripe-webhook-markers";

type AnalyticsIdentity = Pick<User, "app_metadata"> &
  Partial<Pick<User, "user_metadata">>;

const ACTIVATION_MARKER_PREFIX = "subscription_activation:";

const ACTIVATION_PENDING_PREFIX = "subscription_activation:pending:";

const ACTIVATION_PROCESSING_PREFIX = "subscription_activation:processing:";

const ACTIVATION_SENT_PREFIX = "subscription_activation:sent:";

type ActivationMarkerStatus = "pending" | "processing" | "sent";

type ActivationMarkerClaim =
  | { status: "claimed"; lease: string }
  | { status: "sent" }
  | { status: "busy" };

function activationMarkerId(userId: string, subscriptionId: string): string {
  return `${ACTIVATION_MARKER_PREFIX}${userId}:${subscriptionId}`;
}

export function activationAnalyticsMarkerId(
  userId: string,
  subscriptionId: string,
  cycleToken: string | null,
): string {
  const marker = activationMarkerId(userId, subscriptionId);
  return cycleToken ? `${marker}:${cycleToken}` : marker;
}

function activationPendingMarkerId(userId: string, subscriptionId: string): string {
  return `${ACTIVATION_PENDING_PREFIX}${userId}:${subscriptionId}`;
}

function activationProcessingMarkerId(userId: string, subscriptionId: string): string {
  return `${ACTIVATION_PROCESSING_PREFIX}${userId}:${subscriptionId}`;
}

function activationSentMarkerId(userId: string, subscriptionId: string): string {
  return `${ACTIVATION_SENT_PREFIX}${userId}:${subscriptionId}`;
}

export async function clearActivationMarkers(
  sr: ServiceClient,
  userId: string,
  subscriptionId: string,
): Promise<void> {
  const markerIds = [
    activationSentMarkerId(userId, subscriptionId),
    activationMarkerId(userId, subscriptionId),
    activationPendingMarkerId(userId, subscriptionId),
    activationProcessingMarkerId(userId, subscriptionId),
  ];
  for (const markerId of markerIds) {
    const result = await sr
      .from("stripe_webhook_events")
      .delete()
      .eq("event_id", markerId);
    if (result.error) {
      throw new Error(`activation marker cleanup failed: ${result.error.message}`);
    }
  }
}

async function readActivationMarker(
  sr: ServiceClient,
  userId: string,
  subscriptionId: string,
): Promise<ActivationMarkerStatus | null> {
  if (
    (await readWebhookMarker(sr, activationSentMarkerId(userId, subscriptionId))) ||
    // Preserve the marker id used by the first implementation as a durable
    // sent receipt when upgrading an existing deployment without a migration.
    (await readWebhookMarker(sr, activationMarkerId(userId, subscriptionId)))
  ) {
    return "sent";
  }
  if (await readWebhookMarker(sr, activationProcessingMarkerId(userId, subscriptionId))) {
    return "processing";
  }
  if (await readWebhookMarker(sr, activationPendingMarkerId(userId, subscriptionId))) {
    return "pending";
  }
  return null;
}

export async function hasPendingActivationMarker(
  sr: ServiceClient,
  userId: string,
  subscriptionId: string,
): Promise<boolean> {
  const status = await readActivationMarker(sr, userId, subscriptionId);
  return status === "pending" || status === "processing";
}

export async function ensureActivationMarker(
  sr: ServiceClient,
  userId: string,
  subscriptionId: string,
): Promise<void> {
  await insertWebhookMarker(
    sr,
    activationPendingMarkerId(userId, subscriptionId),
  );
}

async function claimActivationMarker(
  sr: ServiceClient,
  userId: string,
  subscriptionId: string,
): Promise<ActivationMarkerClaim> {
  const sent = await readWebhookMarker(sr, activationSentMarkerId(userId, subscriptionId));
  const legacySent = await readWebhookMarker(sr, activationMarkerId(userId, subscriptionId));
  if (sent || legacySent) return { status: "sent" };
  await ensureActivationMarker(sr, userId, subscriptionId);
  const claim = await claimLeasedWebhookMarker(
    sr,
    activationProcessingMarkerId(userId, subscriptionId),
  );
  return claim.status === "claimed"
    ? { status: "claimed", lease: claim.lease }
    : claim.status === "busy"
      ? { status: "busy" }
      : { status: "sent" };
}

async function markActivationSent(
  sr: ServiceClient,
  userId: string,
  subscriptionId: string,
): Promise<void> {
  await insertWebhookMarker(
    sr,
    activationSentMarkerId(userId, subscriptionId),
  );
}

async function markActivationPending(
  sr: ServiceClient,
  userId: string,
  subscriptionId: string,
  lease: string,
): Promise<void> {
  const result = await sr
    .from("stripe_webhook_events")
    .update({ received_at: new Date(0).toISOString() })
    .eq("event_id", activationProcessingMarkerId(userId, subscriptionId))
    .eq("received_at", lease)
    .select("event_id");
  if (result.error) {
    throw new Error(`activation marker pending transition failed: ${result.error.message}`);
  }
}

/**
 * Claim one durable activation marker before emitting analytics. Stripe can
 * deliver checkout.completed and subscription.updated concurrently; the
 * conditional state transition makes one worker the owner. A crash leaves a
 * processing lease that a later delivery can reclaim, while sink failures
 * transition the row back to pending for a retry.
 */
export async function captureSubscriptionActivatedOnce(
  sr: ServiceClient,
  userId: string,
  subscriptionId: string,
  properties: Parameters<typeof captureSubscriptionActivated>[1],
  identity: AnalyticsIdentity | undefined,
  options?: Parameters<typeof captureSubscriptionActivated>[3],
): Promise<void> {
  const claim = await claimActivationMarker(sr, userId, subscriptionId);
  if (claim.status === "sent") return;
  if (claim.status === "busy") {
    // A live owner may still be in PostHog. Keep this Stripe delivery
    // retryable rather than acknowledging an activation that might be lost.
    throw new Error("subscription activation marker is busy");
  }

  let status: SubscriptionActivationCaptureStatus;
  try {
    status =
      (await captureSubscriptionActivated(userId, properties, identity, options)) ??
      "sent";
  } catch (error) {
    // Treat an unexpected sink exception like a reported failed status. The
    // activation remains pending and the webhook can acknowledge safely;
    // state-transition failures below still surface as 500s.
    await markActivationPending(sr, userId, subscriptionId, claim.lease);
    console.error("[stripe-webhook] activation analytics threw", {
      errorId: "WEBHOOK_ACTIVATION_ANALYTICS_THROW",
      marker: activationMarkerId(userId, subscriptionId),
      error,
    });
    throw error;
  }

  if (status === "failed") {
    // PostHog failures are a durable outbox retry, not a Stripe delivery
    // success. Return 5xx so Stripe retries the same event and can reclaim it.
    await markActivationPending(sr, userId, subscriptionId, claim.lease);
    throw new Error("subscription activation analytics delivery failed");
  }

  // `skipped` is a deliberate non-retryable result (smoke/non-production or
  // invalid attribution), so mark the activation delivered just like sent.
  await markActivationSent(sr, userId, subscriptionId);
}

/**
 * Resolve the trusted Auth metadata immediately before a server business
 * event. A missing lookup is treated as an unknown identity so a human event
 * is not silently lost; only the true service-managed marker suppresses it.
 */
export async function loadAnalyticsIdentity(
  sr: ServiceClient,
  userId: string,
): Promise<AnalyticsIdentity | undefined> {
  const admin = sr.auth?.admin as unknown as {
    getUserById?: (
      id: string,
    ) => Promise<{
      data: { user: User | null };
      error: { message?: string } | null;
    }>;
  } | undefined;
  if (typeof admin?.getUserById !== "function") return undefined;

  try {
    const { data, error } = await admin.getUserById(userId);
    if (error) {
      console.error("[stripe-webhook] analytics identity lookup failed", {
        errorId: "WEBHOOK_ANALYTICS_IDENTITY_LOOKUP_FAIL",
        message: error.message ?? "unknown error",
      });
      return undefined;
    }
    return data?.user ?? undefined;
  } catch (error: unknown) {
    console.error("[stripe-webhook] analytics identity lookup threw", {
      errorId: "WEBHOOK_ANALYTICS_IDENTITY_LOOKUP_THROW",
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
