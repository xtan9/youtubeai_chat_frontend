import { getStripe, deriveTier, periodEndToIso } from "@/lib/services/stripe";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import type Stripe from "stripe";

export const runtime = "nodejs"; // need raw body
export const dynamic = "force-dynamic";

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>;

export async function POST(request: Request) {
  const sig = request.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = getStripe();
  const sr = getServiceRoleClient();
  if (!secret || !stripe || !sr) {
    console.error("[stripe-webhook] not configured", {
      errorId: "WEBHOOK_NOT_CONFIGURED",
      hasSecret: !!secret, hasStripe: !!stripe, hasSr: !!sr,
    });
    return new Response("Service unavailable", { status: 503 });
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

  // Idempotency: insert event_id; on conflict, this is a duplicate.
  const ins = await sr
    .from("stripe_webhook_events")
    .upsert({ event_id: event.id }, { onConflict: "event_id", ignoreDuplicates: true })
    .select("event_id");
  if (ins.error) {
    console.error("[stripe-webhook] idempotency insert failed", {
      errorId: "WEBHOOK_IDEMPOTENCY_FAIL", id: event.id, code: ins.error.code,
    });
    return new Response("DB error", { status: 500 });
  }
  if (!ins.data || ins.data.length === 0) {
    // Conflict — already processed
    return new Response("ok", { status: 200 });
  }

  try {
    await dispatch(event, sr, stripe);
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[stripe-webhook] handler threw", {
      errorId: "WEBHOOK_HANDLER_THREW", id: event.id, type: event.type, err,
    });
    // 5xx → Stripe retries (good — we want it to retry on transient failures)
    return new Response("handler error", { status: 500 });
  }
}

async function dispatch(
  event: Stripe.Event,
  sr: ServiceClient,
  stripe: Stripe,
): Promise<void> {
  // Filled in Tasks 6, 7, 8.
  void sr; void stripe;
  switch (event.type) {
    case "checkout.session.completed":
      // Task 6
      break;
    case "customer.subscription.updated":
      // Task 7
      break;
    case "customer.subscription.deleted":
      // Task 8
      break;
    case "invoice.payment_failed":
    case "invoice.paid":
      // No-op — subscription.updated covers state changes
      break;
    default:
      // Ignore
      break;
  }
}
