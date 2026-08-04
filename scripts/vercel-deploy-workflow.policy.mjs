import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflowPath = new URL(
  "../.github/workflows/vercel-deploy.yml",
  import.meta.url,
);
const workflow = readFileSync(workflowPath, "utf8");
const normalizedWorkflow = workflow.replace(/\\\r?\n\s*/g, " ");

test("verifies token access to the configured Vercel project before deploying", () => {
  const accessCheck = workflow.indexOf("- name: Verify Vercel project access");
  const deployment = workflow.indexOf("- name: Deploy through Vercel remote build");

  assert.notEqual(accessCheck, -1, "missing Vercel project-access preflight");
  assert.ok(accessCheck < deployment, "project-access preflight must run before deploy");
  assert.match(
    workflow,
    /vercel@\S+ project inspect "\$VERCEL_PROJECT_ID"[\s\S]*--scope="\$VERCEL_ORG_ID"[\s\S]*--token="\$VERCEL_TOKEN"/,
  );
});

test("authenticates every Vercel CLI operation explicitly in CI", () => {
  const commands = normalizedWorkflow
    .split(/\r?\n/)
    .filter((line) => line.includes("npx --yes vercel@"));

  assert.ok(commands.length > 0, "workflow must invoke the Vercel CLI");
  for (const command of commands) {
    assert.match(command, /--token="\$VERCEL_TOKEN"/, command.trim());
  }
});

test("places Vercel auth flags before the curl subcommand", () => {
  const curlCommand = normalizedWorkflow
    .split(/\r?\n/)
    .find((line) => line.includes("vercel@") && line.includes(" curl "));

  assert.ok(curlCommand, "workflow must verify the deployment with vercel curl");
  assert.match(
    curlCommand,
    /vercel@\S+\s+--scope="\$VERCEL_ORG_ID"\s+--token="\$VERCEL_TOKEN"\s+curl /,
  );
});

test("does not pull local settings when Vercel performs the remote build", () => {
  assert.doesNotMatch(workflow, /vercel@\S+ pull\b/);
});
