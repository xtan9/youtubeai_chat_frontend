import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const MAX_CAPTURED_STDOUT_CHARS = 64 * 1024;
const FORCE_KILL_GRACE_MS = 250;

export type BoundedCommandInput = Readonly<{
  executable: string;
  args: readonly string[];
  timeoutMs: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  captureStdout?: boolean;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
}>;

export type BoundedCommandResult = Readonly<{
  exitCode: number;
  timedOut: boolean;
  stdout?: string;
}>;

/**
 * Execute one fixture boundary without a shell and enforce a real wall-clock
 * deadline. Output capture is opt-in and bounded; normal fixture diagnostics
 * stream to the caller so a noisy child cannot grow this process indefinitely.
 */
export function runBoundedCommand(
  input: BoundedCommandInput,
): Promise<BoundedCommandResult> {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1) {
    return Promise.reject(new Error("Project readiness command deadline is invalid"));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(input.executable, [...input.args], {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      // On POSIX, a separate process group lets the deadline reach ordinary
      // descendants such as Vitest workers and psql helpers. Windows uses
      // taskkill's parent-tree traversal below.
      detached: process.platform !== "win32",
    });
    let settled = false;
    let timedOut = false;
    let capturedStdout = "";
    let forceKillTimer: NodeJS.Timeout | undefined;

    const deadline = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child, "SIGTERM");
      forceKillTimer = setTimeout(
        () => terminateProcessTree(child, "SIGKILL"),
        FORCE_KILL_GRACE_MS,
      );
      forceKillTimer.unref();
    }, input.timeoutMs);
    deadline.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      input.onStdout?.(chunk);
      if (input.captureStdout && capturedStdout.length < MAX_CAPTURED_STDOUT_CHARS) {
        capturedStdout += chunk
          .toString("utf8")
          .slice(0, MAX_CAPTURED_STDOUT_CHARS - capturedStdout.length);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => input.onStderr?.(chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({
        exitCode: timedOut ? 1 : (code ?? 1),
        timedOut,
        ...(input.captureStdout ? { stdout: capturedStdout } : {}),
      });
    });
  });
}

function terminateProcessTree(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const result = spawnSync(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      { shell: false, windowsHide: true, stdio: "ignore" },
    );
    if (result.status !== 0) child.kill(signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}
