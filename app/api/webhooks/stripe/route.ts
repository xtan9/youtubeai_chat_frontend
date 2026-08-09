import { getStripe, deriveTier, periodEndToIso, readCurrentPeriodEnd } from "@/lib/services/stripe";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import type { User } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { z } from "zod";
import {
  captureSubscriptionActivated,
  type SubscriptionActivationCaptureStatus,
} from "@/lib/analytics/server";
import {
  SubscriptionDiscoveryAuthenticationStateSchema,
  SubscriptionDiscoveryDeviceClassSchema,
  SubscriptionDiscoveryPresentationStateSchema,
  SubscriptionDiscoverySourceSurfaceSchema,
  type SubscriptionDiscoveryAttribution,
} from "@/lib/analytics/subscription-discovery";

export const runtime = "nodejs"; // need raw body
export const dynamic = "force-dynamic";

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>;
type AnalyticsIdentity = Pick<User, "app_metadata"> &
  Partial<Pick<User, "user_metadata">>;

const STRIPE_EVENT_LEASE_MS = 5 * 60 * 1000;
const STRIPE_EVENT_PROCESSING_PREFIX = "stripe_event:processing:";
const STRIPE_EVENT_SENT_PREFIX = "stripe_event:sent:";

type StripeEventClaim =
  | { status: "claimed"; lease: string }
  | { status: "processed" }
  | { status: "busy" };

const CheckoutAttributionSchema = z
  .object({
    source_surface: SubscriptionDiscoverySourceSurfaceSchema,
    presentation_state: SubscriptionDiscoveryPresentationStateSchema,
    authentication_state: SubscriptionDiscoveryAuthenticationStateSchema,
    device_class: SubscriptionDiscoveryDeviceClassSchema,
  })
  .strict();

function checkoutAttribution(
  metadata: Stripe.Metadata | null | undefined,
): SubscriptionDiscoveryAttribution | null {
  const parsed = CheckoutAttributionSchema.safeParse({
    source_surface: metadata?.source_surface,
    presentation_state: metadata?.presentation_state,
    authentication_state: metadata?.authentication_state,
    device_class: metadata?.device_class,
  });
  return parsed.success ? parsed.data : null;
}

// Architectural canary for the original P2.11 bug: when status is active
// or trialing, tier MUST be "pro". If we derived "free", something
// upstream silently dropped period_end (basil schema drift, malformed
// payload, retire-and-replace). Refuse to write the poisoned row and
// throw so the outer catch expires the processing lease and Stripe
// retries — same pattern as DB errors. Returning 200 with a poisoned
// write was the exact failure mode we shipped; this guard converts it
// to an alertable 500 + retry.
function assertActiveSubscriptionGotProTier(
  status: Stripe.Subscription.Status,
  tier: "free" | "pro",
  context: { eventId: string; subId: string },
): void {
  if ((status === "active" || status === "trialing") && tier === "free") {
    console.error(
      "[stripe-webhook] active subscription derived tier=free — refusing poisoned write",
      {
        errorId: "WEBHOOK_ACTIVE_FREE_TIER_DEFECT",
        ...context,
        status,
      },
    );
    throw new Error(
      `active subscription ${context.subId} resolved to tier=free`,
    );
  }
}

export async function POST(request: Request) {
  const sig = request.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = getStripe();
  const sr = getServiceRoleClient();
  if (!secret || !stripe || !sr) {
    // Stripe Dashboard shows the response body verbatim on failed events,
    // so naming the missing component here is the operator's first signal
    // during a misconfig.
    const missing: string[] = [];
    if (!secret) missing.push("STRIPE_WEBHOOK_SECRET");
    if (!stripe) missing.push("STRIPE_API_CLIENT");
    if (!sr) missing.push("SUPABASE_SERVICE_ROLE");
    console.error("[stripe-webhook] not configured", {
      errorId: "WEBHOOK_NOT_CONFIGURED",
      hasSecret: !!secret, hasStripe: !!stripe, hasSr: !!sr,
      missing,
    });
    return new Response(
      `Service unavailable: missing ${missing.join(", ")}`,
      { status: 503 },
    );
  }

  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed", {
      errorId: "WEBHOOK_BAD_SIGNATURE",
      err,
    });
    return new Response("Bad signature", { status: 400 });
  }

  // Idempotency uses a leased event state so a crash before dispatch cannot
  // permanently acknowledge the Stripe delivery.
  let eventClaim: StripeEventClaim;
  try {
    eventClaim = await claimStripeEvent(sr, event.id);
  } catch (err) {
    console.error("[stripe-webhook] idempotency claim failed", {
      errorId: "WEBHOOK_IDEMPOTENCY_FAIL", id: event.id, err,
    });
    return new Response("DB error", { status: 500 });
  }
  if (eventClaim.status === "processed") return new Response("ok", { status: 200 });
  if (eventClaim.status === "busy") {
    return new Response("retrying", { status: 500 });
  }
  try {
    await dispatch(event, sr, stripe);
    await markStripeEventProcessed(sr, event.id);
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[stripe-webhook] handler threw", {
      errorId: "WEBHOOK_HANDLER_THREW", id: event.id, type: event.type, err,
    });
    try {
      await markStripeEventRetry(sr, event.id, eventClaim.lease);
    } catch (retryErr) {
      console.error("[stripe-webhook] failed to release event lease", {
        errorId: "WEBHOOK_IDEMPOTENCY_CLEANUP_FAIL",
        id: event.id,
        retryErr,
      });
    }
    return new Response("handler error", { status: 500 });
  }
}


async function claimStripeEvent(
  sr: ServiceClient,
  eventId: string,
): Promise<StripeEventClaim> {
  // The raw event_id was the original idempotency marker. Treat it as a
  // completed receipt for compatibility with rows written before the leased
  // processing marker was introduced.
  if (
    (await readWebhookMarker(sr, eventId)) ||
    (await readWebhookMarker(sr, stripeEventSentMarkerId(eventId)))
  ) {
    return { status: "processed" };
  }

  const claim = await claimLeasedWebhookMarker(
    sr,
    stripeEventProcessingMarkerId(eventId),
  );
  return claim.status === "claimed"
    ? { status: "claimed", lease: claim.lease }
    : claim.status === "busy"
      ? { status: "busy" }
      : { status: "processed" };
}

async function markStripeEventProcessed(
  sr: ServiceClient,
  eventId: string,
): Promise<void> {
  await insertWebhookMarker(sr, stripeEventSentMarkerId(eventId));
}

async function markStripeEventRetry(
  sr: ServiceClient,
  eventId: string,
  lease: string,
): Promise<void> {
  const result = await sr
    .from("stripe_webhook_events")
    .update({ received_at: new Date(0).toISOString() })
    .eq("event_id", stripeEventProcessingMarkerId(eventId))
    .eq("received_at", lease)
    .select("event_id");
  if (result.error) {
    throw new Error(`stripe event retry transition failed: ${result.error.message}`);
  }
}

type LeasedWebhookClaim =
  | { status: "claimed"; lease: string }
  | { status: "busy" }
  | { status: "processed" };

function stripeEventProcessingMarkerId(eventId: string): string {
  return `${STRIPE_EVENT_PROCESSING_PREFIX}${eventId}`;
}

function stripeEventSentMarkerId(eventId: string): string {
  return `${STRIPE_EVENT_SENT_PREFIX}${eventId}`;
}

function createLeaseTimestamp(): string {
  return new Date(Date.now() + STRIPE_EVENT_LEASE_MS).toISOString();
}

async function readWebhookMarker(
  sr: ServiceClient,
  markerId: string,
): Promise<{ receivedAt: string } | null> {
  const result = await sr
    .from("stripe_webhook_events")
    .select("event_id,received_at")
    .eq("event_id", markerId)
    .maybeSingle();
  if (result.error) {
    throw new Error(`webhook marker lookup failed: ${result.error.message}`);
  }
  const receivedAt = result.data?.received_at;
  return typeof receivedAt === "string" ? { receivedAt } : null;
}

async function insertWebhookMarker(
  sr: ServiceClient,
  markerId: string,
): Promise<boolean> {
  const result = await sr
    .from("stripe_webhook_events")
    .upsert(
      { event_id: markerId },
      { onConflict: "event_id", ignoreDuplicates: true },
    )
    .select("event_id");
  if (result.error) {
    throw new Error(`webhook marker persist failed: ${result.error.message}`);
  }
  return Boolean(result.data && result.data.length > 0);
}

async function claimLeasedWebhookMarker(
  sr: ServiceClient,
  markerId: string,
): Promise<LeasedWebhookClaim> {
  const lease = createLeaseTimestamp();
  const inserted = await sr
    .from("stripe_webhook_events")
    .upsert(
      { event_id: markerId, received_at: lease },
      { onConflict: "event_id", ignoreDuplicates: true },
    )
    .select("event_id");
  if (inserted.error) {
    throw new Error(`webhook marker claim failed: ${inserted.error.message}`);
  }
  if (inserted.data && inserted.data.length > 0) {
    return { status: "claimed", lease };
  }

  const current = await readWebhookMarker(sr, markerId);
  if (!current) throw new Error("webhook marker disappeared during claim");
  const now = new Date().toISOString();
  if (current.receivedAt >= now) return { status: "busy" };

  const reclaimed = await sr
    .from("stripe_webhook_events")
    .update({ received_at: lease })
    .eq("event_id", markerId)
    .eq("received_at", current.receivedAt)
    .select("event_id");
  if (reclaimed.error) {
    throw new Error(`webhook marker reclaim failed: ${reclaimed.error.message}`);
  }
  return reclaimed.data && reclaimed.data.length > 0
    ? { status: "claimed", lease }
    : { status: "busy" };
}

async function dispatch(
  event: Stripe.Event,
  sr: ServiceClient,
  stripe: Stripe,
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = (session.metadata?.user_id ?? session.client_reference_id) as string | undefined;
      const subId = typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;
      const customerId = typeof session.customer === "string"
        ? session.customer
        : session.customer?.id;
      if (!userId || !subId || !customerId) {
        console.error("[stripe-webhook] checkout.completed missing fields", {
          errorId: "WEBHOOK_CHECKOUT_MISSING_FIELDS",
          id: event.id, userId, subId, customerId,
        });
        return;
      }
      const sub = await stripe.subscriptions.retrieve(subId);
      const periodEnd = periodEndToIso(readCurrentPeriodEnd(sub));
      const cycleToken = activationCycleToken(sub);
      const tier = deriveTier(sub.status, periodEnd);
      const plan = priceIdToPlan(sub);
      assertActiveSubscriptionGotProTier(sub.status, tier, {
        eventId: event.id,
        subId: sub.id,
      });

      // checkout.completed can race subscription.updated. Read the prior
      // entitlement before writing this event so an already-Pro replacement
      // does not create a second activation.
      const { data: priorRow, error: priorLookupErr } = await sr
        .from("user_subscriptions")
        .select("tier")
        .eq("user_id", userId)
        .maybeSingle();
      if (priorLookupErr) {
        throw new Error(`prior subscription lookup failed: ${priorLookupErr.message}`);
      }
      const hasPendingActivationRetry = priorRow?.tier === "pro"
        ? await hasPendingActivationMarker(sr, userId, sub.id)
        : false;
      const shouldCaptureActivation =
        tier === "pro" &&
        (sub.status === "active" || sub.status === "trialing") &&
        (priorRow?.tier !== "pro" || hasPendingActivationRetry);
      if (shouldCaptureActivation) {
        // Persist the pending outbox marker before the entitlement write. A
        // crash between these operations remains recoverable on redelivery.
        await ensureActivationMarker(sr, userId, sub.id);
      }

      const { error } = await sr.from("user_subscriptions").upsert(
        {
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: sub.id,
          tier,
          plan,
          status: sub.status,
          current_period_end: periodEnd,
          cancel_at_period_end: sub.cancel_at_period_end,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw new Error(`upsert failed: ${error.message}`);
      if (shouldCaptureActivation) {
        const attribution = checkoutAttribution(session.metadata);
        await captureSubscriptionActivatedOnce(
          sr,
          userId,
          sub.id,
          attribution
            ? {
                ...attribution,
                plan: plan ?? "unknown",
                billing_interval: plan ?? "unknown",
                subscription_status: sub.status === "trialing" ? "trialing" : "active",
              }
            : {
                source_surface: "stripe_webhook",
                plan: plan ?? "unknown",
                billing_interval: plan ?? "unknown",
                subscription_status: sub.status === "trialing" ? "trialing" : "active",
              },
          await loadAnalyticsIdentity(sr, userId),
          {
            activationMarker: activationAnalyticsMarkerId(
              userId,
              sub.id,
              cycleToken,
            ),
          },
        );
      }
      break;
    }
    case "customer.subscription.updated": {
      let sub = event.data.object as Stripe.Subscription;
      // Stripe may redeliver an older active update after a newer deletion
      // (or downgrade). Refresh the authoritative object before writing
      // entitlements so a stale payload cannot resurrect Pro access.
      try {
        const refreshed = await stripe.subscriptions.retrieve(sub.id);
        if (refreshed?.id === sub.id) {
          // Preserve governed attribution if an older Stripe account omits
          // metadata from the refreshed representation; fresh fields win.
          sub = {
            ...sub,
            ...refreshed,
            metadata: { ...(sub.metadata ?? {}), ...(refreshed.metadata ?? {}) },
          };
        }
      } catch (error) {
        throw new Error(
          `subscription refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const periodEnd = periodEndToIso(readCurrentPeriodEnd(sub));
      const cycleToken = activationCycleToken(sub);
      const tier = deriveTier(sub.status, periodEnd);
      const plan = priceIdToPlan(sub);
      assertActiveSubscriptionGotProTier(sub.status, tier, {
        eventId: event.id,
        subId: sub.id,
      });

      // Find user_id by stripe_customer_id (we own the mapping)
      const { data: row, error: lookupErr } = await sr
        .from("user_subscriptions")
        .select("user_id,tier,status,stripe_subscription_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      if (lookupErr) {
        // DB error — throw so the outer try/catch returns 500 and expires the
        // processing lease, so Stripe's retry can re-run dispatch.
        throw new Error(`customer lookup failed: ${lookupErr.message}`);
      }
      if (!row?.user_id) {
        console.error("[stripe-webhook] subscription.updated for unknown customer", {
          errorId: "WEBHOOK_UNKNOWN_CUSTOMER",
          id: event.id, customerId,
        });
        return;
      }

      // Keep the historical transition guard: an unrelated update for a
      // subscription that is already Pro must not emit a second activation.
      // Only a durable pending/processing marker permits a retry for that row.
      const isProTransition = row.tier !== "pro";
      const hasPendingActivationRetry = !isProTransition
        ? await hasPendingActivationMarker(sr, row.user_id, sub.id)
        : false;
      const shouldCaptureActivation =
        tier === "pro" &&
        (sub.status === "active" || sub.status === "trialing") &&
        (isProTransition || hasPendingActivationRetry);
      if (row.tier === "pro" && tier !== "pro") {
        await clearActivationMarkers(sr, row.user_id, sub.id);
      }
      if (shouldCaptureActivation) {
        // Claim the durable outbox before writing Pro so a crash cannot leave
        // an unmarked Pro row that suppresses the only activation event.
        await ensureActivationMarker(sr, row.user_id, sub.id);
      }

      const { error } = await sr.from("user_subscriptions").upsert(
        {
          user_id: row.user_id,
          stripe_customer_id: customerId,
          stripe_subscription_id: sub.id,
          tier,
          plan,
          status: sub.status,
          current_period_end: periodEnd,
          cancel_at_period_end: sub.cancel_at_period_end,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw new Error(`upsert failed: ${error.message}`);
      if (shouldCaptureActivation) {
        const attribution = checkoutAttribution(sub.metadata);
        await captureSubscriptionActivatedOnce(
          sr,
          row.user_id,
          sub.id,
          attribution
            ? {
                ...attribution,
                plan: plan ?? "unknown",
                billing_interval: plan ?? "unknown",
                subscription_status: sub.status === "trialing" ? "trialing" : "active",
              }
            : {
                source_surface: "stripe_webhook",
                plan: plan ?? "unknown",
                billing_interval: plan ?? "unknown",
                subscription_status: sub.status === "trialing" ? "trialing" : "active",
              },
          await loadAnalyticsIdentity(sr, row.user_id),
          {
            activationMarker: activationAnalyticsMarkerId(
              row.user_id,
              sub.id,
              cycleToken,
            ),
          },
        );
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

      const { data: row, error: lookupErr } = await sr
        .from("user_subscriptions")
        .select("user_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      if (lookupErr) {
        // DB error — throw so the outer try/catch returns 500 and expires the
        // processing lease, so Stripe's retry can re-run dispatch.
        throw new Error(`customer lookup failed: ${lookupErr.message}`);
      }
      if (!row?.user_id) {
        console.error("[stripe-webhook] subscription.deleted for unknown customer", {
          errorId: "WEBHOOK_UNKNOWN_CUSTOMER",
          id: event.id, customerId,
        });
        return;
      }

      const periodEnd = periodEndToIso(readCurrentPeriodEnd(sub));

      await clearActivationMarkers(
        sr,
        row.user_id,
        sub.id,
      );

      const { error } = await sr.from("user_subscriptions").upsert(
        {
          user_id: row.user_id,
          stripe_customer_id: customerId,
          stripe_subscription_id: null,
          tier: "free",
          plan: null,
          status: sub.status,
          current_period_end: periodEnd,
          cancel_at_period_end: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw new Error(`upsert failed: ${error.message}`);
      break;
    }
    case "invoice.payment_failed":
    case "invoice.paid":
      // No-op — subscription.updated covers state changes
      break;
    default:
      // Ignore
      break;
  }
}

const ACTIVATION_MARKER_PREFIX = "subscription_activation:";
const ACTIVATION_PENDING_PREFIX = "subscription_activation:pending:";
const ACTIVATION_PROCESSING_PREFIX = "subscription_activation:processing:";
const ACTIVATION_SENT_PREFIX = "subscription_activation:sent:";

/**
 * Stable discriminator for one Stripe subscription billing cycle. The
 * durable claim marker intentionally remains keyed by user/subscription so
 * the existing no-migration state machine stays compatible; this token is
 * only used for the deterministic analytics UUID. A later Pro cycle after a
 * downgrade therefore gets a new UUID while concurrent deliveries for the
 * same cycle retain the same UUID.
 */
function activationCycleToken(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0] as
    | (Stripe.SubscriptionItem & {
        current_period_start?: unknown;
        current_period_end?: unknown;
      })
    | undefined;
  const topStart = (sub as Stripe.Subscription & { current_period_start?: unknown })
    .current_period_start;
  // Basil payloads place both period boundaries on the subscription item;
  // older API shapes expose them at the subscription level.
  const start = item?.current_period_start ?? topStart;
  const top = (sub as Stripe.Subscription & { current_period_end?: unknown })
    .current_period_end;
  const end = item?.current_period_end ?? top;
  if (
    typeof start !== "number" ||
    !Number.isFinite(start) ||
    typeof end !== "number" ||
    !Number.isFinite(end)
  ) {
    return null;
  }
  return `${Math.trunc(start)}-${Math.trunc(end)}`;
}

type ActivationMarkerStatus = "pending" | "processing" | "sent";
type ActivationMarkerClaim =
  | { status: "claimed"; lease: string }
  | { status: "sent" }
  | { status: "busy" };

function activationMarkerId(userId: string, subscriptionId: string): string {
  return `${ACTIVATION_MARKER_PREFIX}${userId}:${subscriptionId}`;
}

function activationAnalyticsMarkerId(
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

async function clearActivationMarkers(
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

async function hasPendingActivationMarker(
  sr: ServiceClient,
  userId: string,
  subscriptionId: string,
): Promise<boolean> {
  const status = await readActivationMarker(sr, userId, subscriptionId);
  return status === "pending" || status === "processing";
}

async function ensureActivationMarker(
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
async function captureSubscriptionActivatedOnce(
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
async function loadAnalyticsIdentity(
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

function priceIdToPlan(sub: Stripe.Subscription): "monthly" | "yearly" | null {
  const priceId = sub.items?.data[0]?.price?.id;
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return "monthly";
  if (priceId === process.env.STRIPE_PRICE_YEARLY) return "yearly";
  return null;
}
