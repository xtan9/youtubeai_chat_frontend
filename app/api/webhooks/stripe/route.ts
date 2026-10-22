import { getStripe } from "@/lib/services/stripe";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import type Stripe from "stripe";
import {
  type StripeEventClaim,
  claimStripeEvent,
  markStripeEventProcessed,
  markStripeEventRetry,
} from "../../../../lib/billing/stripe-webhook-markers";
import {
  dispatchStripeSubscriptionEvent,
} from "../../../../lib/billing/stripe-subscription-events";

export const runtime = "nodejs";

// need raw body
export const dynamic = "force-dynamic";

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

  // Idempotency uses a leased event state so a crash before dispatchStripeSubscriptionEvent cannot
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
    await dispatchStripeSubscriptionEvent(event, sr, stripe);
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
