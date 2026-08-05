import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/production-smoke.yml", import.meta.url),
  "utf8",
);

function sectionBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing workflow marker: ${startMarker.trim()}`);

  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing workflow marker: ${endMarker.trim()}`);
  return source.slice(start, end);
}

test("retains the hourly production smoke cadence", () => {
  assert.match(workflow, /cron:\s*"0 \* \* \* \*"/);
});

test("isolates live Summary checks with a bounded retry budget", () => {
  const browserJob = sectionBetween(
    workflow,
    "  e2e-smoke:",
    "\n  session-policy-smoke:",
  );
  const nonMutatingStep = sectionBetween(
    browserJob,
    "      - name: Run non-mutating browser smoke",
    "\n      - name: Run live Summary browser smoke",
  );
  const liveSummaryStep = sectionBetween(
    browserJob,
    "      - name: Run live Summary browser smoke",
    "\n      - uses: actions/upload-artifact@v6",
  );

  assert.match(
    nonMutatingStep,
    /playwright test --grep-invert "@session-policy\|@account-mutating\|@account-recovery\|@live-summary"/,
  );
  assert.match(
    liveSummaryStep,
    /if:\s*\$\{\{\s*!cancelled\(\)\s*\}\}/,
  );
  assert.match(
    liveSummaryStep,
    /pnpm exec playwright test\s+--grep "@live-summary"\s+--workers=2\s+--retries=0/,
  );
  assert.doesNotMatch(
    liveSummaryStep,
    /smoke-tests\//,
    "the @live-summary tag must be the single source of live-suite membership",
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
  const sessionJobHeader = sectionBetween(
    sessionJobBody,
    "  session-policy-smoke:",
    "\n    steps:",
  );
  const sessionPolicyStep = sectionBetween(
    sessionJobBody,
    "      - name: Run serial production session policy journey",
    "\n      - name: Preserve redacted session-policy evidence",
  );

  assert.match(sessionJobHeader, /needs:\s*\[api-smoke, e2e-smoke\]/);
  assert.match(
    sessionJobHeader,
    /if:\s*\$\{\{\s*always\(\)\s*&&\s*!cancelled\(\)\s*&&\s*needs\.api-smoke\.result\s*==\s*'success'\s*\}\}/,
  );
  assert.doesNotMatch(
    sessionJobHeader,
    /needs\.e2e-smoke\.result/,
    "browser failures must not gate the downstream session-policy job",
  );
  assert.match(sessionJobHeader, /timeout-minutes:\s*10/);
  assert.match(
    sessionPolicyStep,
    /playwright test smoke-tests\/e2e-auth-session-policy\.spec\.ts --grep "@session-policy" --workers=1/,
  );
  assert.doesNotMatch(
    sessionPolicyStep,
    /needs\.e2e-smoke\.result/,
    "browser failures must not gate the session-policy step",
  );
});

test("publishes only the redacted session-policy evidence manifest", () => {
  assert.match(workflow, /SESSION_POLICY_EVIDENCE_PATH:/);
  assert.match(workflow, /name: production-session-policy-evidence/);
  assert.match(workflow, /path: test-results\/session-policy-evidence\.json/);
  assert.match(workflow, /if: always\(\)/);
});
