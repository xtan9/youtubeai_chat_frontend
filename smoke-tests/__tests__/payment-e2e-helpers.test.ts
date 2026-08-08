import { describe, expect, it, vi } from "vitest";
import {
  assertPaymentE2EEnabled,
  cleanupPaymentTestPromotion,
  cleanupPaymentTestUser,
  createPaymentTestPromotion,
  loadPaymentE2EConfig,
  type PaymentE2EClients,
  type PaymentTestPromotion,
  type SubscriptionRow,
  verifyStripeSubscription,
} from "../payment-e2e-helpers";

function validEnv(): Record<string, string | undefined> {
  return {
    PAYMENT_E2E_ENABLED: "1",
    PAYMENT_E2E_BASE_URL: "https://payment-e2e.youtubeai-preview.test",
    PRODUCTION_BASE_URL: "https://www.youtubeai.chat",
    PAYMENT_E2E_SUPABASE_URL: "https://staging-project.supabase.co",
    PRODUCTION_SUPABASE_URL: "https://production-project.supabase.co",
    PAYMENT_E2E_SUPABASE_SECRET_KEY: "sb_secret_staging",
    PAYMENT_E2E_STRIPE_SECRET_KEY: "sk_test_example",
    PAYMENT_E2E_STRIPE_PRICE_MONTHLY: "price_monthly",
    PAYMENT_E2E_STRIPE_PRICE_YEARLY: "price_yearly",
  };
}

describe("payment E2E safety configuration", () => {
  it("accepts an isolated test-mode environment", () => {
    const config = loadPaymentE2EConfig(validEnv());

    expect(config.baseUrl).toBe("https://payment-e2e.youtubeai-preview.test");
    expect(config.stripePriceIds).toEqual({
      monthly: "price_monthly",
      yearly: "price_yearly",
    });
  });

  it("lists every missing variable without printing secret values", () => {
    expect(() => loadPaymentE2EConfig({})).toThrow(
      /PAYMENT_E2E_BASE_URL.*PAYMENT_E2E_STRIPE_PRICE_YEARLY/,
    );
  });

  it.each(["https://youtubeai.chat", "https://www.youtubeai.chat"])(
    "refuses the production application host %s",
    (baseUrl) => {
      const env = validEnv();
      env.PAYMENT_E2E_BASE_URL = baseUrl;
      expect(() => loadPaymentE2EConfig(env)).toThrow(/production application/);
    },
  );

  it("refuses an application URL matching the configured production origin", () => {
    const env = validEnv();
    env.PRODUCTION_BASE_URL = env.PAYMENT_E2E_BASE_URL;
    expect(() => loadPaymentE2EConfig(env)).toThrow(/production application/);
  });

  it("refuses the production Supabase project", () => {
    const env = validEnv();
    env.PAYMENT_E2E_SUPABASE_URL = env.PRODUCTION_SUPABASE_URL;
    expect(() => loadPaymentE2EConfig(env)).toThrow(/production Supabase/);
  });

  it.each(["sk_live_example", "rk_test_example", "secret"])(
    "refuses a non-test Stripe secret key (%s)",
    (key) => {
      const env = validEnv();
      env.PAYMENT_E2E_STRIPE_SECRET_KEY = key;
      expect(() => loadPaymentE2EConfig(env)).toThrow(/test-mode secret key/);
    },
  );

  it("refuses duplicate monthly and yearly Stripe prices", () => {
    const env = validEnv();
    env.PAYMENT_E2E_STRIPE_PRICE_YEARLY = env.PAYMENT_E2E_STRIPE_PRICE_MONTHLY;
    expect(() => loadPaymentE2EConfig(env)).toThrow(/must be different/);
  });

  it("allows HTTP only for local development", () => {
    const local = validEnv();
    local.PAYMENT_E2E_BASE_URL = "http://localhost:3000";
    expect(loadPaymentE2EConfig(local).baseUrl).toBe("http://localhost:3000");

    const remote = validEnv();
    remote.PAYMENT_E2E_BASE_URL = "http://staging.example.com";
    expect(() => loadPaymentE2EConfig(remote)).toThrow(/must use HTTPS/);
  });

  it("requires an explicit opt-in before an integration run", () => {
    expect(() => assertPaymentE2EEnabled(validEnv())).not.toThrow();
    expect(() => assertPaymentE2EEnabled({ PAYMENT_E2E_ENABLED: "true" })).toThrow(
      /exactly 1/,
    );
  });
});

function cleanupClients(
  row: SubscriptionRow | null,
  customer: { id: string; deleted: false; metadata: Record<string, string> },
) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  const deleteRow = vi.fn().mockResolvedValue({ error: null });
  const deleteUser = vi.fn().mockResolvedValue({ error: null });
  const listCustomers = vi.fn().mockResolvedValue({ data: [customer] });
  const retrieveCustomer = vi.fn().mockResolvedValue(customer);
  const deleteCustomer = vi.fn().mockResolvedValue({ id: customer.id, deleted: true });
  const from = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ maybeSingle }),
    }),
    delete: vi.fn().mockReturnValue({ eq: deleteRow }),
  });

  const clients = {
    supabase: {
      from,
      auth: { admin: { deleteUser } },
    },
    stripe: {
      customers: {
        list: listCustomers,
        retrieve: retrieveCustomer,
        del: deleteCustomer,
      },
    },
  } as unknown as PaymentE2EClients;

  return {
    clients,
    deleteCustomer,
    deleteRow,
    deleteUser,
    listCustomers,
  };
}

describe("payment E2E cleanup", () => {
  const user = {
    userId: "user-1",
    email: "payment-e2e@example.com",
    password: "unused",
  };
  const row: SubscriptionRow = {
    user_id: user.userId,
    stripe_customer_id: "cus_test",
    stripe_subscription_id: "sub_test",
    tier: "pro",
    plan: "monthly",
    status: "active",
  };

  it("deletes only the metadata-linked Stripe customer, row, and auth user", async () => {
    const harness = cleanupClients(row, {
      id: "cus_test",
      deleted: false,
      metadata: { user_id: user.userId },
    });

    await cleanupPaymentTestUser(harness.clients, user);

    expect(harness.listCustomers).toHaveBeenCalledWith({ email: user.email, limit: 100 });
    expect(harness.deleteCustomer).toHaveBeenCalledWith("cus_test");
    expect(harness.deleteRow).toHaveBeenCalledWith("user_id", user.userId);
    expect(harness.deleteUser).toHaveBeenCalledWith(user.userId);
  });

  it("refuses to delete a customer whose metadata belongs to another user", async () => {
    const harness = cleanupClients(row, {
      id: "cus_test",
      deleted: false,
      metadata: { user_id: "someone-else" },
    });

    await expect(cleanupPaymentTestUser(harness.clients, user)).rejects.toThrow(
      /Payment E2E cleanup failed/,
    );
    expect(harness.deleteCustomer).not.toHaveBeenCalled();
    expect(harness.deleteRow).toHaveBeenCalledWith("user_id", user.userId);
    expect(harness.deleteUser).toHaveBeenCalledWith(user.userId);
  });

  it("reports an email-matched orphan when no subscription row can prove ownership", async () => {
    const harness = cleanupClients(null, {
      id: "cus_orphan",
      deleted: false,
      metadata: {},
    });

    await expect(cleanupPaymentTestUser(harness.clients, user)).rejects.toThrow(
      /Payment E2E cleanup failed/,
    );
    expect(harness.deleteCustomer).not.toHaveBeenCalled();
    expect(harness.deleteUser).toHaveBeenCalledWith(user.userId);
  });

  it("continues deterministic cleanup when customer discovery reports an error", async () => {
    const harness = cleanupClients(row, {
      id: "cus_test",
      deleted: false,
      metadata: { user_id: user.userId },
    });
    harness.listCustomers.mockRejectedValueOnce(new Error("Stripe unavailable"));

    await expect(cleanupPaymentTestUser(harness.clients, user)).rejects.toThrow(
      /Payment E2E cleanup failed/,
    );
    expect(harness.deleteCustomer).toHaveBeenCalledWith("cus_test");
    expect(harness.deleteRow).toHaveBeenCalledWith("user_id", user.userId);
    expect(harness.deleteUser).toHaveBeenCalledWith(user.userId);
  });
});

describe("payment E2E promotion codes", () => {
  it("creates an isolated one-use test promotion", async () => {
    const createCoupon = vi.fn().mockResolvedValue({ id: "coupon_test" });
    const createPromotionCode = vi.fn().mockResolvedValue({
      id: "promo_test",
      code: "PAYMENT-E2E-ABC123",
    });
    const stripe = {
      coupons: { create: createCoupon, del: vi.fn() },
      promotionCodes: { create: createPromotionCode },
    } as unknown as PaymentE2EClients["stripe"];

    const promotion = await createPaymentTestPromotion(stripe, "monthly");

    expect(createCoupon).toHaveBeenCalledWith({
      duration: "once",
      max_redemptions: 1,
      metadata: { payment_e2e: "true", plan: "monthly" },
      name: "YouTubeAI payment E2E 50% off once",
      percent_off: 50,
    });
    expect(createPromotionCode).toHaveBeenCalledWith({
      code: expect.stringMatching(/^PAYMENT-E2E-[A-F0-9]+$/),
      max_redemptions: 1,
      metadata: { payment_e2e: "true", plan: "monthly" },
      promotion: { coupon: "coupon_test", type: "coupon" },
    });
    expect(promotion).toEqual({
      couponId: "coupon_test",
      promotionCodeId: "promo_test",
      code: "PAYMENT-E2E-ABC123",
    });
  });

  it("deletes the coupon when promotion creation fails", async () => {
    const deleteCoupon = vi.fn().mockResolvedValue({ deleted: true });
    const stripe = {
      coupons: {
        create: vi.fn().mockResolvedValue({ id: "coupon_test" }),
        del: deleteCoupon,
      },
      promotionCodes: {
        create: vi.fn().mockRejectedValue(new Error("Stripe unavailable")),
      },
    } as unknown as PaymentE2EClients["stripe"];

    await expect(createPaymentTestPromotion(stripe, "yearly")).rejects.toThrow(
      /Stripe unavailable/,
    );
    expect(deleteCoupon).toHaveBeenCalledWith("coupon_test");
  });

  it("deactivates the promotion code before deleting its coupon", async () => {
    const calls: string[] = [];
    const stripe = {
      coupons: {
        del: vi.fn().mockImplementation(async () => {
          calls.push("coupon");
          return { deleted: true };
        }),
      },
      promotionCodes: {
        update: vi.fn().mockImplementation(async () => {
          calls.push("promotion");
          return { active: false };
        }),
      },
    } as unknown as PaymentE2EClients["stripe"];
    const promotion: PaymentTestPromotion = {
      couponId: "coupon_test",
      promotionCodeId: "promo_test",
      code: "PAYMENT-E2E-ABC123",
    };

    await cleanupPaymentTestPromotion(stripe, promotion);

    expect(stripe.promotionCodes.update).toHaveBeenCalledWith("promo_test", {
      active: false,
    });
    expect(stripe.coupons.del).toHaveBeenCalledWith("coupon_test");
    expect(calls).toEqual(["promotion", "coupon"]);
  });

  it("verifies the redeemed promotion on the Stripe subscription", async () => {
    const retrieveSubscription = vi.fn().mockResolvedValue({
      customer: "cus_test",
      discounts: [
        {
          id: "di_test",
          promotion_code: "promo_test",
        },
      ],
      items: { data: [{ price: { id: "price_monthly" } }] },
      status: "active",
    });
    const retrievePromotionCode = vi.fn().mockResolvedValue({ times_redeemed: 1 });
    const stripe = {
      promotionCodes: { retrieve: retrievePromotionCode },
      subscriptions: { retrieve: retrieveSubscription },
    } as unknown as PaymentE2EClients["stripe"];
    const row: SubscriptionRow = {
      user_id: "user-1",
      stripe_customer_id: "cus_test",
      stripe_subscription_id: "sub_test",
      tier: "pro",
      plan: "monthly",
      status: "active",
    };

    await verifyStripeSubscription(stripe, row, "price_monthly", "promo_test");

    expect(retrieveSubscription).toHaveBeenCalledWith("sub_test", {
      expand: ["discounts"],
    });
    expect(retrievePromotionCode).toHaveBeenCalledWith("promo_test");
  });

  it("rejects a subscription that did not redeem the expected promotion", async () => {
    const stripe = {
      promotionCodes: {
        retrieve: vi.fn().mockResolvedValue({ times_redeemed: 0 }),
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          customer: "cus_test",
          discounts: [],
          items: { data: [{ price: { id: "price_monthly" } }] },
          status: "active",
        }),
      },
    } as unknown as PaymentE2EClients["stripe"];
    const row: SubscriptionRow = {
      user_id: "user-1",
      stripe_customer_id: "cus_test",
      stripe_subscription_id: "sub_test",
      tier: "pro",
      plan: "monthly",
      status: "active",
    };

    await expect(
      verifyStripeSubscription(stripe, row, "price_monthly", "promo_test"),
    ).rejects.toThrow(/promotion code/);
  });
});
