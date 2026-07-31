import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { classifyPaths } from "./vercel-deployment-policy.mjs";

test("skips documentation, CI, test, script, and migration-only changes", () => {
  const result = classifyPaths([
    "docs/operations.md",
    ".github/workflows/ci.yml",
    "app/components/__tests__/panel.test.tsx",
    "scripts/seed-data.ts",
    "supabase/migrations/20260101000000_example.sql",
  ]);

  assert.equal(result.deploy, false);
  assert.deepEqual(result.runtimePaths, []);
});

test("deploys application, content, dependency, and build configuration changes", () => {
  for (const filePath of [
    "app/page.tsx",
    "components/chat.tsx",
    "content/blog/launch.md",
    "lib/services/client.ts",
    "next.config.ts",
    "package.json",
    "pnpm-lock.yaml",
    "public/logo.svg",
    "unknown/new-path.txt",
  ]) {
    assert.equal(classifyPaths([filePath]).deploy, true, filePath);
  }
});

test("deploys fail-open when no changed paths are available", () => {
  assert.equal(classifyPaths([]).deploy, true);
});

test("CLI deploys fail-open when comparison SHAs are invalid", () => {
  const scriptPath = fileURLToPath(
    new URL("./vercel-deployment-policy.mjs", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [scriptPath, "definitely-not-a-commit", "HEAD"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /^deploy=true$/m);
});
