import { deriveTier, periodEndToIso, readCurrentPeriodEnd } from "@/lib/services/stripe";
import type Stripe from "stripe";
import { z } from "zod";
import {
  SubscriptionDiscoveryAuthenticationStateSchema,
  SubscriptionDiscoveryDeviceClassSchema,
  SubscriptionDiscoveryPresentationStateSchema,
  SubscriptionDiscoverySourceSurfaceSchema,
  type SubscriptionDiscoveryAttribution,
} from "@/lib/analytics/subscription-discovery";
import { type ServiceClient } from "./stripe-webhook-markers";
import {
  activationAnalyticsMarkerId,
  clearActivationMarkers,
  hasPendingActivationMarker,
  ensureActivationMarker,
  captureSubscriptionActivatedOnce,
  loadAnalyticsIdentity,
} from "./stripe-activation-outbox";

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

export async function dispatchStripeSubscriptionEvent(event: Stripe.Event, sr: ServiceClient, stripe: Stripe): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(event, sr, stripe);
    case "customer.subscription.updated":
      return handleSubscriptionUpdated(event, sr, stripe);
    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(event, sr);
    default:
      // Invoice events and unrelated events do not change subscriptions.
      return;
  }
}

async function handleCheckoutCompleted(event: Stripe.Event, sr: ServiceClient, stripe: Stripe): Promise<void> {
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
}

async function handleSubscriptionUpdated(event: Stripe.Event, sr: ServiceClient, stripe: Stripe): Promise<void> {
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
}

async function handleSubscriptionDeleted(event: Stripe.Event, sr: ServiceClient): Promise<void> {
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
}

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

function priceIdToPlan(sub: Stripe.Subscription): "monthly" | "yearly" | null {
  const priceId = sub.items?.data[0]?.price?.id;
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return "monthly";
  if (priceId === process.env.STRIPE_PRICE_YEARLY) return "yearly";
  return null;
}
