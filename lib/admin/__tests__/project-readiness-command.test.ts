import { describe, expect, it } from "vitest";

import { runBoundedCommand } from "../project-readiness-command";
import {
  buildDisposableReadinessPsqlEnvironment,
  resolveDisposableReadinessDatabase,
} from "../project-readiness-database";

describe("runBoundedCommand", () => {
  it("executes a real child process and captures bounded stdout on success", async () => {
    const result = await runBoundedCommand({
      executable: process.execPath,
      args: ["-e", "process.stdout.write('ready')"],
      timeoutMs: 2_000,
      captureStdout: true,
    });

    expect(result).toEqual({ exitCode: 0, timedOut: false, stdout: "ready" });
  });

  it("returns a nonzero child exit without converting it to success", async () => {
    const result = await runBoundedCommand({
      executable: process.execPath,
      args: ["-e", "process.exit(7)"],
      timeoutMs: 2_000,
    });

    expect(result).toMatchObject({ exitCode: 7, timedOut: false });
  });

  it("rejects when the executable cannot be spawned", async () => {
    await expect(
      runBoundedCommand({
        executable: "project-readiness-command-does-not-exist",
        args: [],
        timeoutMs: 2_000,
      }),
    ).rejects.toThrow();
  });

  it("terminates a child that exceeds its bounded deadline", async () => {
    const startedAt = Date.now();
    const result = await runBoundedCommand({
      executable: process.execPath,
      args: ["-e", "setInterval(() => {}, 1_000)"],
      timeoutMs: 100,
    });

    expect(result).toMatchObject({ exitCode: 1, timedOut: true });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("terminates descendants when a fixture process exceeds its deadline", async () => {
    const result = await runBoundedCommand({
      executable: process.execPath,
      args: [
        "-e",
        [
          "const { spawn } = require('node:child_process');",
          "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: process.platform === 'win32', stdio: 'ignore' });",
          "process.stdout.write(String(child.pid));",
          "setInterval(() => {}, 1000);",
        ].join(" "),
      ],
      timeoutMs: 250,
      captureStdout: true,
    });
    const descendantPid = Number(result.stdout);

    expect(result).toMatchObject({ exitCode: 1, timedOut: true });
    expect(Number.isSafeInteger(descendantPid)).toBe(true);
    await expect
      .poll(() => processExists(descendantPid), { timeout: 2_000 })
      .toBe(false);
  });

  it("keeps inherited libpq redirects out of the real fixture child", async () => {
    const inheritedEnvironment = {
      ...process.env,
      PROJECT_READINESS_ALLOW_DATABASE_FIXTURES: "true",
      PROJECT_READINESS_DATABASE_URL:
        "postgresql://postgres:postgres@127.0.0.1:57589/project_readiness_issue328",
      PROJECT_READINESS_DATABASE_NAME: "project_readiness_issue328",
      PROJECT_READINESS_DATABASE_HOST_ALLOWLIST: "127.0.0.1",
      PROJECT_READINESS_DATABASE_NAME_ALLOWLIST: "project_readiness_issue328",
      PGHOSTADDR: "198.51.100.77",
      PGHOST: "production-db.internal",
      PGSERVICE: "production",
      PGSERVICEFILE: "/tmp/production-service.conf",
      PGSYSCONFDIR: "/tmp/production-postgres",
      PGPASSFILE: "/tmp/production.pgpass",
      PGOPTIONS: "-c search_path=production",
    };
    const target = resolveDisposableReadinessDatabase(inheritedEnvironment);
    const result = await runBoundedCommand({
      executable: process.execPath,
      args: [
        "-e",
        "process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase().startsWith('PG')))))",
      ],
      timeoutMs: 2_000,
      captureStdout: true,
      env: buildDisposableReadinessPsqlEnvironment(
        inheritedEnvironment,
        target,
      ),
    });

    expect(result).toEqual({
      exitCode: 0,
      timedOut: false,
      stdout: JSON.stringify({ PGDATABASE: target.databaseUrl }),
    });
  });
});

function processExists(processId: number) {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}
