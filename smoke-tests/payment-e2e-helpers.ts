import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export type PaymentPlan = "monthly" | "yearly";

export type PaymentE2EConfig = {
  baseUrl: string;
  productionBaseUrl: string;
  supabaseUrl: string;
  productionSupabaseUrl: string;
  supabaseSecretKey: string;
  stripeSecretKey: string;
  stripePriceIds: Record<PaymentPlan, string>;
};

export type PaymentTestUser = {
  userId: string;
  email: string;
  password: string;
};

export type PaymentTestPromotion = {
  couponId: string;
  promotionCodeId: string;
  code: string;
};

export type SubscriptionRow = {
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  tier: "free" | "pro";
  plan: PaymentPlan | null;
  status: string | null;
};

export type PaymentE2EClients = {
  supabase: SupabaseClient;
  stripe: Stripe;
};

type PaymentEnv = Record<string, string | undefined>;

const PRODUCTION_HOSTS = new Set(["youtubeai.chat", "www.youtubeai.chat"]);
const REQUIRED_ENV = [
  "PAYMENT_E2E_BASE_URL",
  "PRODUCTION_BASE_URL",
  "PAYMENT_E2E_SUPABASE_URL",
  "PRODUCTION_SUPABASE_URL",
  "PAYMENT_E2E_SUPABASE_SECRET_KEY",
  "PAYMENT_E2E_STRIPE_SECRET_KEY",
  "PAYMENT_E2E_STRIPE_PRICE_MONTHLY",
  "PAYMENT_E2E_STRIPE_PRICE_YEARLY",
] as const;

function requiredEnv(
  env: PaymentEnv,
  name: (typeof REQUIRED_ENV)[number],
): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required payment E2E variable: ${name}`);
  return value;
}

function parseOrigin(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not contain credentials, query parameters, or a fragment`);
  }
  if (url.pathname !== "/") {
    throw new Error(`${name} must be an origin without a path`);
  }
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    throw new Error(`${name} must use HTTPS (HTTP is allowed only for localhost)`);
  }
  return url;
}

export function assertPaymentE2EEnabled(env: PaymentEnv = process.env): void {
  if (env.PAYMENT_E2E_ENABLED?.trim() !== "1") {
    throw new Error("PAYMENT_E2E_ENABLED must be exactly 1");
  }
}

/**
 * Load the integration-test environment and fail closed before any user,
 * subscription, or Stripe customer is created.
 */
export function loadPaymentE2EConfig(
  env: PaymentEnv = process.env,
): PaymentE2EConfig {
  const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required payment E2E variables: ${missing.join(", ")}`);
  }

  const base = parseOrigin(requiredEnv(env, "PAYMENT_E2E_BASE_URL"), "PAYMENT_E2E_BASE_URL");
  const productionBase = parseOrigin(
    requiredEnv(env, "PRODUCTION_BASE_URL"),
    "PRODUCTION_BASE_URL",
  );
  const supabase = parseOrigin(
    requiredEnv(env, "PAYMENT_E2E_SUPABASE_URL"),
    "PAYMENT_E2E_SUPABASE_URL",
  );
  const productionSupabase = parseOrigin(
    requiredEnv(env, "PRODUCTION_SUPABASE_URL"),
    "PRODUCTION_SUPABASE_URL",
  );

  if (PRODUCTION_HOSTS.has(base.hostname) || base.origin === productionBase.origin) {
    throw new Error("Payment E2E refuses to run against the production application");
  }
  if (supabase.origin === productionSupabase.origin) {
    throw new Error("Payment E2E refuses to run against the production Supabase project");
  }

  const stripeSecretKey = requiredEnv(env, "PAYMENT_E2E_STRIPE_SECRET_KEY");
  if (!stripeSecretKey.startsWith("sk_test_")) {
    throw new Error("PAYMENT_E2E_STRIPE_SECRET_KEY must be a Stripe test-mode secret key");
  }

  const monthlyPrice = requiredEnv(env, "PAYMENT_E2E_STRIPE_PRICE_MONTHLY");
  const yearlyPrice = requiredEnv(env, "PAYMENT_E2E_STRIPE_PRICE_YEARLY");
  if (!monthlyPrice.startsWith("price_") || !yearlyPrice.startsWith("price_")) {
    throw new Error("Payment E2E Stripe price IDs must start with price_");
  }
  if (monthlyPrice === yearlyPrice) {
    throw new Error("Monthly and yearly payment E2E price IDs must be different");
  }

  return {
    baseUrl: base.origin,
    productionBaseUrl: productionBase.origin,
    supabaseUrl: supabase.origin,
    productionSupabaseUrl: productionSupabase.origin,
    supabaseSecretKey: requiredEnv(env, "PAYMENT_E2E_SUPABASE_SECRET_KEY"),
    stripeSecretKey,
    stripePriceIds: { monthly: monthlyPrice, yearly: yearlyPrice },
  };
}

export function createPaymentE2EClients(config: PaymentE2EConfig): PaymentE2EClients {
  const supabase = createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const stripe = new Stripe(config.stripeSecretKey, {
    apiVersion: "2025-05-28.basil" as never,
  });
  return { supabase, stripe };
}

export async function createPaymentTestUser(
  supabase: SupabaseClient,
  plan: PaymentPlan,
): Promise<PaymentTestUser> {
  const suffix = randomUUID();
  const email = `payment-e2e-${plan}-${suffix}@example.com`;
  const password = `PayE2e!${suffix}aA9`;
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { payment_e2e: true },
  });
  if (error || !data.user) {
    throw new Error(`Could not create payment E2E user: ${error?.message ?? "no user returned"}`);
  }
  if (data.user.is_anonymous || data.user.app_metadata?.is_smoke_account) {
    throw new Error("Payment E2E user was created with an unsafe entitlement marker");
  }
  return { userId: data.user.id, email, password };
}

export async function createPaymentTestPromotion(
  stripe: Stripe,
  plan: PaymentPlan,
): Promise<PaymentTestPromotion> {
  const coupon = await stripe.coupons.create({
    duration: "once",
    max_redemptions: 1,
    metadata: { payment_e2e: "true", plan },
    name: "YouTubeAI payment E2E 50% off once",
    percent_off: 50,
  });

  try {
    const promotionCode = await stripe.promotionCodes.create({
      code: `PAYMENT-E2E-${randomUUID().replaceAll("-", "").toUpperCase()}`,
      max_redemptions: 1,
      metadata: { payment_e2e: "true", plan },
      promotion: { coupon: coupon.id, type: "coupon" },
    });
    return {
      couponId: coupon.id,
      promotionCodeId: promotionCode.id,
      code: promotionCode.code,
    };
  } catch (error) {
    try {
      await stripe.coupons.del(coupon.id);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Could not create payment E2E promotion or delete coupon ${coupon.id}`,
      );
    }
    throw error;
  }
}

export async function cleanupPaymentTestPromotion(
  stripe: Stripe,
  promotion: PaymentTestPromotion,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await stripe.promotionCodes.update(promotion.promotionCodeId, { active: false });
  } catch (error) {
    errors.push(error);
  }
  try {
    await stripe.coupons.del(promotion.couponId);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Payment E2E promotion cleanup failed");
  }
}

export async function waitForActivatedSubscription(
  supabase: SupabaseClient,
  userId: string,
  plan: PaymentPlan,
  timeoutMs = 60_000,
): Promise<SubscriptionRow> {
  const deadline = Date.now() + timeoutMs;
  let lastState = "no subscription row";

  while (Date.now() < deadline) {
    const { data, error } = await supabase
      .from("user_subscriptions")
      .select("user_id,stripe_customer_id,stripe_subscription_id,tier,plan,status")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`Could not read payment E2E subscription: ${error.message}`);
    const row = data as SubscriptionRow | null;
    if (
      row?.tier === "pro" &&
      row.plan === plan &&
      row.stripe_customer_id &&
      row.stripe_subscription_id
    ) {
      return row;
    }
    lastState = row
      ? `tier=${row.tier}, plan=${row.plan ?? "null"}, status=${row.status ?? "null"}`
      : "no subscription row";
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(`Stripe webhook did not activate ${plan} Pro access (${lastState})`);
}

export async function verifyStripeSubscription(
  stripe: Stripe,
  row: SubscriptionRow,
  expectedPriceId: string,
  expectedPromotionCodeId: string,
): Promise<void> {
  if (!row.stripe_subscription_id) throw new Error("Subscription row has no Stripe subscription ID");
  const subscription = await stripe.subscriptions.retrieve(row.stripe_subscription_id, {
    expand: ["discounts"],
  });
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  if (customerId !== row.stripe_customer_id) {
    throw new Error("Stripe subscription customer does not match Supabase");
  }
  if (!new Set(["active", "trialing"]).has(subscription.status)) {
    throw new Error(`Stripe subscription is not active (status=${subscription.status})`);
  }
  const actualPriceId = subscription.items.data[0]?.price.id;
  if (actualPriceId !== expectedPriceId) {
    throw new Error("Stripe subscription used the wrong price ID");
  }
  const hasExpectedPromotion = subscription.discounts.some((discount) => {
    if (typeof discount === "string") return false;
    const promotionCode = discount.promotion_code;
    return (
      promotionCode === expectedPromotionCodeId ||
      (typeof promotionCode === "object" && promotionCode?.id === expectedPromotionCodeId)
    );
  });
  const promotionCode = await stripe.promotionCodes.retrieve(expectedPromotionCodeId);
  if (!hasExpectedPromotion || promotionCode.times_redeemed !== 1) {
    throw new Error("Stripe subscription did not redeem the expected promotion code");
  }
}

async function readSubscriptionRow(
  supabase: SupabaseClient,
  userId: string,
): Promise<SubscriptionRow | null> {
  const { data, error } = await supabase
    .from("user_subscriptions")
    .select("user_id,stripe_customer_id,stripe_subscription_id,tier,plan,status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as SubscriptionRow | null;
}

/**
 * Remove every artifact owned by one randomized test user. Customer metadata
 * is checked before deletion so a bad lookup can never remove another user.
 */
export async function cleanupPaymentTestUser(
  clients: PaymentE2EClients,
  user: PaymentTestUser,
): Promise<void> {
  const errors: Error[] = [];
  let row: SubscriptionRow | null = null;
  const customerIds = new Set<string>();

  try {
    row = await readSubscriptionRow(clients.supabase, user.userId);
    if (row?.stripe_customer_id) customerIds.add(row.stripe_customer_id);
  } catch (error) {
    errors.push(new Error(`Could not read subscription during cleanup: ${String(error)}`));
  }

  try {
    const customers = await clients.stripe.customers.list({ email: user.email, limit: 100 });
    for (const customer of customers.data) {
      if (customer.deleted) continue;
      if (customer.metadata.user_id !== user.userId) {
        errors.push(
          new Error(`Refusing email-matched Stripe customer ${customer.id} with mismatched metadata`),
        );
        continue;
      }
      customerIds.add(customer.id);
    }
  } catch (error) {
    errors.push(new Error(`Could not discover Stripe customers during cleanup: ${String(error)}`));
  }

  for (const customerId of customerIds) {
    try {
      const customer = await clients.stripe.customers.retrieve(customerId);
      if (!customer.deleted && customer.metadata.user_id !== user.userId) {
        throw new Error("Refusing to delete a Stripe customer owned by another user");
      }
      if (!customer.deleted) await clients.stripe.customers.del(customerId);
    } catch (error) {
      errors.push(new Error(`Could not delete Stripe customer ${customerId}: ${String(error)}`));
    }
  }

  try {
    const { error } = await clients.supabase
      .from("user_subscriptions")
      .delete()
      .eq("user_id", user.userId);
    if (error) throw error;
  } catch (error) {
    errors.push(new Error(`Could not delete subscription row: ${String(error)}`));
  }

  try {
    const { error } = await clients.supabase.auth.admin.deleteUser(user.userId);
    if (error) throw error;
  } catch (error) {
    errors.push(new Error(`Could not delete payment E2E auth user: ${String(error)}`));
  }

  if (errors.length > 0) throw new AggregateError(errors, "Payment E2E cleanup failed");
}
