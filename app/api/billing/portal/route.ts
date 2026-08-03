import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripe } from "@/lib/services/stripe";

export async function POST() {
  const principalResult = await resolveRequestPrincipal({
    source: "billing_portal",
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
  const stripe = getStripe();
  if (!sr || !stripe) {
    return Response.json({ message: "Service unavailable" }, { status: 503 });
  }

  const { data, error: lookupErr } = await sr
    .from("user_subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", principal.userId)
    .maybeSingle();
  if (lookupErr) {
    console.error("[billing/portal] lookup failed", {
      errorId: "BILLING_PORTAL_LOOKUP_FAIL",
      userId: principal.userId,
      code: (lookupErr as { code?: string }).code,
    });
    return Response.json({ message: "Service unavailable" }, { status: 503 });
  }
  if (!data?.stripe_customer_id) {
    return Response.json({ message: "No subscription on file" }, { status: 400 });
  }

  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const session = await stripe.billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: `${siteUrl}/`,
    });
    return Response.json({ url: session.url });
  } catch (err) {
    console.error("[billing/portal] stripe error", {
      errorId: "BILLING_PORTAL_FAIL", userId: principal.userId, err,
    });
    return Response.json({ message: "Service unavailable" }, { status: 503 });
  }
}
