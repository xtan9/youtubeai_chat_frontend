import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/production-smoke.yml", import.meta.url),
  "utf8",
);

test("retains the hourly production smoke cadence", () => {
  assert.match(workflow, /cron:\s*"0 \* \* \* \*"/);
});

test("isolates live Summary checks with a bounded retry budget", () => {
  assert.match(
    workflow,
    /playwright test --grep-invert "@session-policy\|@account-mutating\|@account-recovery\|@live-summary"/,
  );
  assert.match(
    workflow,
    /name: Run live Summary browser smoke[\s\S]*--grep "@live-summary"[\s\S]*--retries=0/,
  );
});

test("runs the session-policy journey after browser smoke in its own job budget", () => {
  const browserSmoke = workflow.indexOf("  e2e-smoke:");
  const sessionJob = workflow.indexOf("  session-policy-smoke:");
  const sessionPolicy = workflow.indexOf(
    "Run serial production session policy journey",
  );

  assert.notEqual(browserSmoke, -1, "missing non-mutating browser job");
  assert.notEqual(sessionJob, -1, "missing session-policy job");
  assert.notEqual(sessionPolicy, -1, "missing serial session-policy phase");
  assert.ok(
    browserSmoke < sessionJob && sessionJob < sessionPolicy,
    "account-mutating journey must follow non-mutating smoke",
  );

  const sessionJobBody = workflow.slice(sessionJob);
  assert.match(sessionJobBody, /needs:\s*\[api-smoke, e2e-smoke\]/);
  assert.match(
    sessionJobBody,
    /if:\s*\$\{\{\s*always\(\)\s*&&\s*!cancelled\(\)\s*&&\s*needs\.api-smoke\.result\s*==\s*'success'\s*\}\}/,
  );
  assert.match(sessionJobBody, /timeout-minutes:\s*10/);
  assert.match(
    sessionJobBody,
    /playwright test smoke-tests\/e2e-auth-session-policy\.spec\.ts --grep "@session-policy" --workers=1/,
  );
});

test("publishes only the redacted session-policy evidence manifest", () => {
  assert.match(workflow, /SESSION_POLICY_EVIDENCE_PATH:/);
  assert.match(workflow, /name: production-session-policy-evidence/);
  assert.match(workflow, /path: test-results\/session-policy-evidence\.json/);
  assert.match(workflow, /if: always\(\)/);
});
