import { describe, expect, it, vi } from "vitest";
import {
  assertPaymentE2EEnabled,
  cleanupPaymentTestUser,
  loadPaymentE2EConfig,
  type PaymentE2EClients,
  type SubscriptionRow,
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
