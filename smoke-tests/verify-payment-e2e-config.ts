import {
  assertPaymentE2EEnabled,
  createPaymentE2EClients,
  loadPaymentE2EConfig,
  verifyStripeSandboxConfiguration,
} from "./payment-e2e-helpers";

async function main(): Promise<void> {
  assertPaymentE2EEnabled();
  const config = loadPaymentE2EConfig();
  const { stripe } = createPaymentE2EClients(config);
  await verifyStripeSandboxConfiguration(stripe, config);

  console.log("Payment E2E preflight passed", {
    applicationHost: new URL(config.baseUrl).hostname,
    supabaseHost: new URL(config.supabaseUrl).hostname,
    stripeMode: "test",
    stripeAccount: config.stripeAccountId,
    plans: Object.keys(config.stripePriceIds),
  });
}

void main();
