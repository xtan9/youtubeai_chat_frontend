import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

function sectionBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing workflow marker: ${startMarker.trim()}`);

  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing workflow marker: ${endMarker.trim()}`);
  return source.slice(start, end);
}

test("registers the Continue Learning pilot CI policy in the deployment-policy job", () => {
  const policyJob = sectionBetween(workflow, "  deployment-policy:", "\n  lint:");

  assert.match(
    policyJob,
    /node --test[\s\S]*scripts\/continue-learning-pilot-ci\.policy\.mjs/,
  );
});

test("runs both fail-closed pilot fixtures on legacy and fresh migration replays", () => {
  const legacyReplay = sectionBetween(
    workflow,
    "      - name: Continue Learning pilot gate - representative legacy",
    "      - name: Anonymous Trial core ledger and concurrency - representative legacy",
  );
  const freshReplay = sectionBetween(
    workflow,
    "      - name: Workspace and Project contract - fresh migration replay",
    "      # Reproduces the cache-write upsert",
  );
  const fixtures = [
    "regression_continue_learning_pilot_gate.sql",
    "regression_continue_learning_pilot_gate_concurrency.sql",
  ];

  for (const fixture of fixtures) {
    assert.match(
      legacyReplay,
      new RegExp(
        `run: psql -v ON_ERROR_STOP=1 -f supabase/test-fixtures/${fixture.replace(".", "\\.")}`,
      ),
      `${fixture} must run against the representative legacy database`,
    );
    assert.match(
      freshReplay,
      new RegExp(
        `PGDATABASE=workspace_fresh psql -v ON_ERROR_STOP=1 -f supabase/test-fixtures/${fixture.replace(".", "\\.")}`,
      ),
      `${fixture} must run against the independent fresh database`,
    );
  }
});
