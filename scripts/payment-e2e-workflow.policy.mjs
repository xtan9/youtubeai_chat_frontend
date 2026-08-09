import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/payment-e2e.yml", import.meta.url);
const workflow = readFileSync(workflowPath, "utf8");

test("runs the application and Supabase locally instead of using hosted staging", () => {
  assert.match(workflow, /PAYMENT_E2E_BASE_URL:\s*http:\/\/127\.0\.0\.1:3000/);
  assert.doesNotMatch(workflow, /secrets\.PAYMENT_E2E_SUPABASE_(?:URL|SECRET_KEY)/);
  assert.doesNotMatch(workflow, /vars\.PAYMENT_E2E_BASE_URL/);
  assert.match(workflow, /uses:\s*supabase\/setup-cli@\S+/);
  assert.match(workflow, /version:\s*"?2\.113\.0"?/);
  assert.match(workflow, /supabase start/);
  assert.match(workflow, /api\.url=PAYMENT_E2E_SUPABASE_URL/);
  assert.match(workflow, /auth\.anon_key=PAYMENT_E2E_SUPABASE_ANON_KEY/);
  assert.match(workflow, /auth\.service_role_key=PAYMENT_E2E_SUPABASE_SECRET_KEY/);
  assert.match(workflow, /PAYMENT_E2E_STRIPE_ACCOUNT_ID:\s*\$\{\{ vars\.PAYMENT_E2E_STRIPE_ACCOUNT_ID \}\}/);
});

test("forwards Stripe sandbox webhooks to the local application", () => {
  assert.match(
    workflow,
    /stripe\/stripe-cli:v1\.45\.1@sha256:[a-f0-9]{64}/,
    "Stripe CLI image must be pinned to an immutable digest",
  );
  assert.match(workflow, /--network host/);
  assert.match(workflow, /--forward-to http:\/\/127\.0\.0\.1:3000\/api\/webhooks\/stripe/);
  assert.match(workflow, /grep -o 'whsec_\[A-Za-z0-9\]\*'.*\|\| true/);
  assert.match(workflow, /STRIPE_WEBHOOK_SECRET=.*GITHUB_ENV/);
});

test("starts the application only after fail-closed payment preflight", () => {
  const localSupabase = workflow.indexOf("supabase start");
  const preflight = workflow.indexOf("pnpm smoke:payment:preflight");
  const localApplication = workflow.indexOf("pnpm dev");
  const browserJourney = workflow.indexOf("pnpm smoke:payment:e2e");

  assert.ok(localSupabase >= 0, "missing local Supabase startup");
  assert.ok(preflight > localSupabase, "preflight must inspect local Supabase configuration");
  assert.ok(localApplication > preflight, "application must start only after preflight passes");
  assert.ok(browserJourney > localApplication, "browser journey must run after application startup");
  assert.match(workflow, /pnpm dev --hostname 127\.0\.0\.1/);
});
