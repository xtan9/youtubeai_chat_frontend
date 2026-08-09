import { z } from "zod";
import {
  SubscriptionDiscoveryDeviceClassSchema,
  SubscriptionDiscoverySourceSurfaceSchema,
} from "@/lib/analytics/subscription-discovery";
import { buildPricingReturnHref } from "@/lib/analytics/subscription-discovery-navigation";
import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveRegisteredSubscription } from "@/lib/services/entitlements";
import { getStripe, priceIdForPlan } from "@/lib/services/stripe";
import { ATTEMPT_ID_PATTERN } from "@/lib/billing/checkout-attempt";

// Stripe's idempotency key protects the remote session create, while this
// short-lived process lock closes the local customer lookup/create TOCTOU for
// concurrent requests carrying the same trusted user+attempt key.
const checkoutAttemptLocks = new Map<string, Promise<void>>();

async function acquireCheckoutAttemptLock(key: string): Promise<() => void> {
  const previous = checkoutAttemptLocks.get(key);
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  checkoutAttemptLocks.set(key, current);
  if (previous) await previous;
  return () => {
    if (checkoutAttemptLocks.get(key) === current) {
      checkoutAttemptLocks.delete(key);
    }
    release();
  };
}

const BodySchema = z.object({
  plan: z.enum(["monthly", "yearly"]),
  source_surface: SubscriptionDiscoverySourceSurfaceSchema.optional().default(
    "direct_pricing",
  ),
  device_class: SubscriptionDiscoveryDeviceClassSchema.optional(),
  attempt_id: z
    .string()
    .regex(ATTEMPT_ID_PATTERN)
    .optional(),
}).strict();

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { code: "invalid_request", message: "Invalid checkout request" },
      { status: 400 },
    );
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { code: "invalid_request", message: "Invalid checkout request" },
      { status: 400 },
    );
  }

  const principalResult = await resolveRequestPrincipal({
    source: "billing_checkout",
  });
  if (principalResult.kind === "unavailable") {
    return Response.json(
      { code: "service_unavailable", message: "Service unavailable" },
      { status: 503 },
    );
  }
  if (
    principalResult.kind === "missing" ||
    principalResult.principal.isAnonymous
  ) {
    return Response.json(
      { code: "authentication_required", message: "Unauthorized" },
      { status: 401 },
    );
  }
  const { principal } = principalResult;

  const subscriptionResult = await resolveRegisteredSubscription(
    principal.userId,
    principal.smokeProEntitled === true,
  );
  if (subscriptionResult.kind === "unavailable") {
    return Response.json(
      { code: "service_unavailable", message: "Service unavailable" },
      { status: 503 },
    );
  }
  if (subscriptionResult.presentation.state !== "free") {
    return Response.json(
      {
        code: "subscription_ineligible",
        message: "Manage your existing subscription in Plan & Billing.",
      },
      { status: 409 },
    );
  }

  // Every checkout attempt must carry a stable caller-generated key. Stripe's
  // idempotency layer can only collapse duplicate sessions when the browser
  // retries the same attempt after a lost response. Accept the key in either
  // field for direct API callers, but reject malformed or conflicting values.
  const bodyAttemptId = parsed.data.attempt_id;
  const headerAttemptId = request.headers.get("Idempotency-Key");
  if (
    (headerAttemptId !== null && !ATTEMPT_ID_PATTERN.test(headerAttemptId)) ||
    (bodyAttemptId &&
      headerAttemptId !== null &&
      bodyAttemptId !== headerAttemptId) ||
    (!bodyAttemptId && headerAttemptId === null)
  ) {
    return Response.json(
      {
        code: "invalid_request",
        message: "A stable checkout attempt is required",
      },
      { status: 400 },
    );
  }
  const attemptId = bodyAttemptId ?? headerAttemptId;

  const sr = getServiceRoleClient();
  if (!sr) {
    return Response.json(
      { code: "service_unavailable", message: "Service unavailable" },
      { status: 503 },
    );
  }
  const stripe = getStripe();
  if (!stripe) {
    return Response.json(
      { code: "service_unavailable", message: "Service unavailable" },
      { status: 503 },
    );
  }

  const priceId = priceIdForPlan(parsed.data.plan);
  if (!priceId) {
    return Response.json(
      { code: "plan_unavailable", message: "Plan unavailable" },
      { status: 503 },
    );
  }

  const releaseAttemptLock = await acquireCheckoutAttemptLock(
    `checkout:${principal.userId}:${attemptId}`,
  );
  try {
    // Look up or create Stripe customer
    const { data: existing, error: lookupErr } = await sr
      .from("user_subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", principal.userId)
      .maybeSingle();
    if (lookupErr) {
      console.error("[billing/checkout] lookup failed", {
        errorId: "BILLING_CHECKOUT_LOOKUP_FAIL",
        userId: principal.userId,
        code: (lookupErr as { code?: string }).code,
      });
      return Response.json(
        { code: "service_unavailable", message: "Service unavailable" },
        { status: 503 },
      );
    }

    let customerId = existing?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create(
        {
          email: principal.email ?? undefined,
          metadata: { user_id: principal.userId },
        },
        { idempotencyKey: `customer-create-${principal.userId}` },
      );
      customerId = customer.id;
      const { error } = await sr.from("user_subscriptions").upsert({
        user_id: principal.userId,
        stripe_customer_id: customerId,
        tier: "free",
      });
      if (error) {
        console.error("[billing/checkout] upsert failed (aborting checkout)", {
          errorId: "BILLING_UPSERT_FAIL",
          userId: principal.userId,
          code: error.code,
        });
        return Response.json(
          { code: "service_unavailable", message: "Service unavailable" },
          { status: 503 },
        );
      }
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const cancelPath = buildPricingReturnHref({
      plan: parsed.data.plan,
      sourceSurface: parsed.data.source_surface,
      canceled: true,
    });
    const idempotencyKey = attemptId
      ? `checkout-${principal.userId}-${attemptId}`
      : undefined;
    const metadata: Record<string, string> = {
      user_id: principal.userId,
      plan: parsed.data.plan,
      source_surface: parsed.data.source_surface,
    };
    if (parsed.data.device_class) {
      metadata.presentation_state = "upgrade_to_pro";
      metadata.authentication_state = "registered";
      metadata.device_class = parsed.data.device_class;
    }
    const checkoutParams: Parameters<
      typeof stripe.checkout.sessions.create
    >[0] = {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: principal.userId,
      metadata,
      // Stripe copies this metadata onto the Subscription object. Keeping the
      // governed discovery dimensions here means a subscription.updated event
      // can still attribute activation when it arrives before
      // checkout.session.completed.
      subscription_data: { metadata },
      success_url: `${siteUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}${cancelPath}`,
      allow_promotion_codes: true,
    };
    const session = idempotencyKey
      ? await stripe.checkout.sessions.create(checkoutParams, {
          idempotencyKey,
        })
      : await stripe.checkout.sessions.create(checkoutParams);

    return Response.json({ url: session.url });
  } catch (err) {
    console.error("[billing/checkout] stripe error", {
      errorId: "BILLING_CHECKOUT_FAIL",
      userId: principal.userId,
      err,
    });
    return Response.json(
      { code: "service_unavailable", message: "Service unavailable" },
      { status: 503 },
    );
  } finally {
    releaseAttemptLock();
  }
}
