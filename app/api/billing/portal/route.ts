import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripe } from "@/lib/services/stripe";

export async function POST() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user || (user.is_anonymous ?? false)) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  const sr = getServiceRoleClient();
  const stripe = getStripe();
  if (!sr || !stripe) {
    return Response.json({ message: "Service unavailable" }, { status: 503 });
  }

  const { data } = await sr
    .from("user_subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
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
      errorId: "BILLING_PORTAL_FAIL", userId: user.id, err,
    });
    return Response.json({ message: "Service unavailable" }, { status: 503 });
  }
}
