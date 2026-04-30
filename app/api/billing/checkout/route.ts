import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
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

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user || (user.is_anonymous ?? false)) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

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
    const { data: existing } = await sr
      .from("user_subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    let customerId = existing?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      const { error } = await sr.from("user_subscriptions").upsert({
        user_id: user.id,
        stripe_customer_id: customerId,
        tier: "free",
      });
      if (error) {
        console.error("[billing/checkout] upsert failed (aborting checkout)", {
          errorId: "BILLING_UPSERT_FAIL",
          userId: user.id,
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
      client_reference_id: user.id,
      metadata: { user_id: user.id },
      success_url: `${siteUrl}/billing/success`,
      cancel_url: `${siteUrl}/pricing?canceled=1`,
      allow_promotion_codes: true,
    });

    return Response.json({ url: session.url });
  } catch (err) {
    console.error("[billing/checkout] stripe error", {
      errorId: "BILLING_CHECKOUT_FAIL",
      userId: user.id,
      err,
    });
    return Response.json({ message: "Service unavailable" }, { status: 503 });
  }
}
