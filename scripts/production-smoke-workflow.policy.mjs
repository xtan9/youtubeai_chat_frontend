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

test("runs the session-policy journey after non-mutating smoke", () => {
  const nonMutating = workflow.indexOf("Run non-mutating browser smoke");
  const sessionPolicy = workflow.indexOf(
    "Run serial production session policy journey",
  );

  assert.notEqual(nonMutating, -1, "missing non-mutating browser phase");
  assert.notEqual(sessionPolicy, -1, "missing serial session-policy phase");
  assert.ok(
    nonMutating < sessionPolicy,
    "account-mutating journey must follow non-mutating smoke",
  );
  assert.match(
    workflow,
    /playwright test --grep-invert "@session-policy\|@account-mutating\|@account-recovery"/,
  );
  assert.match(
    workflow,
    /playwright test smoke-tests\/e2e-auth-session-policy\.spec\.ts --grep "@session-policy" --workers=1/,
  );
});

test("publishes only the redacted session-policy evidence manifest", () => {
  assert.match(workflow, /SESSION_POLICY_EVIDENCE_PATH:/);
  assert.match(workflow, /name: production-session-policy-evidence/);
  assert.match(workflow, /path: test-results\/session-policy-evidence\.json/);
  assert.match(workflow, /if: always\(\)/);
});
