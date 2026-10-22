import { getServiceRoleClient } from "@/lib/supabase/service-role";

export type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>;

const STRIPE_EVENT_LEASE_MS = 5 * 60 * 1000;

const STRIPE_EVENT_PROCESSING_PREFIX = "stripe_event:processing:";

const STRIPE_EVENT_SENT_PREFIX = "stripe_event:sent:";

export type StripeEventClaim =
  | { status: "claimed"; lease: string }
  | { status: "processed" }
  | { status: "busy" };

export async function claimStripeEvent(
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

export async function markStripeEventProcessed(
  sr: ServiceClient,
  eventId: string,
): Promise<void> {
  await insertWebhookMarker(sr, stripeEventSentMarkerId(eventId));
}

export async function markStripeEventRetry(
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

export async function readWebhookMarker(
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

export async function insertWebhookMarker(
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

export async function claimLeasedWebhookMarker(
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
