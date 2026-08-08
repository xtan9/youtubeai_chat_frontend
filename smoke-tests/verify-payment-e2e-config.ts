import {
  assertPaymentE2EEnabled,
  loadPaymentE2EConfig,
} from "./payment-e2e-helpers";

assertPaymentE2EEnabled();
const config = loadPaymentE2EConfig();

console.log("Payment E2E preflight passed", {
  applicationHost: new URL(config.baseUrl).hostname,
  supabaseHost: new URL(config.supabaseUrl).hostname,
  stripeMode: "test",
  plans: Object.keys(config.stripePriceIds),
});
