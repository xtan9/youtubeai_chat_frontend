import { z } from "zod";
import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { isStripeCheckoutSessionId } from "@/lib/billing/checkout-return";
import { checkCheckoutStatusRateLimit } from "@/lib/services/checkout-status-rate-limit";
import { resolveRegisteredSubscription } from "@/lib/services/entitlements";
import { getStripe } from "@/lib/services/stripe";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  session_id: z
    .string()
    .trim()
    .max(255)
    .refine(isStripeCheckoutSessionId),
});

export async function GET(request: Request) {
  const sessionIds = new URL(request.url).searchParams.getAll("session_id");
  const parsed = QuerySchema.safeParse(
    sessionIds.length === 1 ? { session_id: sessionIds[0] } : {},
  );
  if (!parsed.success) {
    return Response.json({ message: "Invalid checkout session" }, { status: 400 });
  }

  const principalResult = await resolveRequestPrincipal({
    source: "billing_checkout",
  });
  if (principalResult.kind === "unavailable") {
    return Response.json({ message: "Service unavailable" }, { status: 503 });
  }
  if (
    principalResult.kind === "missing" ||
    principalResult.principal.isAnonymous
  ) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { principal } = principalResult;
  const rateLimit = await checkCheckoutStatusRateLimit(principal.userId);
  if (!rateLimit.allowed) {
    if (rateLimit.reason === "unavailable") {
      return Response.json({ message: "Service unavailable" }, { status: 503 });
    }
    return Response.json(
      { message: "Too many activation checks" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const stripe = getStripe();
  if (!stripe) {
    return Response.json({ message: "Service unavailable" }, { status: 503 });
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(parsed.data.session_id);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "resource_missing"
    ) {
      return Response.json(
        { message: "Checkout session not found" },
        { status: 404 },
      );
    }
    console.error("[billing/checkout/status] Stripe lookup failed", {
      errorId: "BILLING_CHECKOUT_STATUS_STRIPE_FAIL",
      userId: principal.userId,
      error,
    });
    return Response.json({ message: "Service unavailable" }, { status: 503 });
  }
  const sessionUserId =
    session.metadata?.user_id ?? session.client_reference_id ?? null;
  if (
    sessionUserId !== principal.userId ||
    session.mode !== "subscription" ||
    session.status !== "complete"
  ) {
    return Response.json({ message: "Checkout session not found" }, { status: 404 });
  }

  const checkoutSubscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id ?? null;
  if (!checkoutSubscriptionId) {
    return Response.json({ status: "pending" });
  }

  const subscription = await resolveRegisteredSubscription(
    principal.userId,
    // This endpoint confirms a real Stripe checkout journey. A trusted
    // smoke-only entitlement can grant product access, but it is not proof
    // that this Checkout Session's webhook has updated the Subscription row.
    false,
  );
  if (subscription.kind === "unavailable") {
    return Response.json({ message: "Service unavailable" }, { status: 503 });
  }

  if (
    subscription.stripeSubscriptionId === checkoutSubscriptionId &&
    subscription.tier === "pro" &&
    (subscription.presentation.state === "active_pro" ||
      subscription.presentation.state === "pro_pending_cancellation")
  ) {
    return Response.json({
      status: "active",
      subscriptionPresentation: subscription.presentation,
    });
  }

  return Response.json({ status: "pending" });
}
