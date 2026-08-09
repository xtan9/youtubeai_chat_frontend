import { z } from "zod";
import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripe, priceIdForPlan } from "@/lib/services/stripe";

const BodySchema = z.object({
  plan: z.enum(["monthly", "yearly"]),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "Invalid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ message: "Invalid plan" }, { status: 400 });
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

  const sr = getServiceRoleClient();
  if (!sr) {
    return Response.json({ message: "Service unavailable" }, { status: 503 });
  }
  const stripe = getStripe();
  if (!stripe) {
    return Response.json({ message: "Service unavailable" }, { status: 503 });
  }

  const priceId = priceIdForPlan(parsed.data.plan);
  if (!priceId) {
    return Response.json({ message: "Plan unavailable" }, { status: 503 });
  }

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
      return Response.json({ message: "Service unavailable" }, { status: 503 });
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
        return Response.json({ message: "Service unavailable" }, { status: 503 });
      }
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: principal.userId,
      metadata: { user_id: principal.userId },
      success_url: `${siteUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/pricing?canceled=1`,
      allow_promotion_codes: true,
    });

    return Response.json({ url: session.url });
  } catch (err) {
    console.error("[billing/checkout] stripe error", {
      errorId: "BILLING_CHECKOUT_FAIL",
      userId: principal.userId,
      err,
    });
    return Response.json({ message: "Service unavailable" }, { status: 503 });
  }
}
