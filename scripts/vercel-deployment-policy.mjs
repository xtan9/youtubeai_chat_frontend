import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const NON_RUNTIME_PREFIXES = [
  ".claude/",
  ".github/",
  "coverage/",
  "docs/",
  "examples/",
  "scripts/",
  "smoke-tests/",
  "supabase/",
  "test-results/",
  "tests-utils/",
];

const NON_RUNTIME_ROOT_FILES = new Set([
  ".gitignore",
  "CLAUDE.md",
  "CONTEXT.md",
  "CONTRIBUTING.md",
  "FRONTEND_ROADMAP.md",
  "README.md",
  "playwright.config.ts",
  "vitest.config.ts",
]);

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isNonRuntimePath(filePath) {
  const normalized = normalizePath(filePath);

  if (NON_RUNTIME_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }

  if (NON_RUNTIME_ROOT_FILES.has(normalized)) {
    return true;
  }

  if (!normalized.includes("/") && normalized.endsWith(".md")) {
    return true;
  }

  return (
    /(^|\/)__tests__\//.test(normalized) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)
  );
}

export function classifyPaths(filePaths) {
  const paths = filePaths.map(normalizePath).filter(Boolean);
  const runtimePaths = paths.filter((filePath) => !isNonRuntimePath(filePath));
  const ignoredPaths = paths.filter(isNonRuntimePath);

  // An empty or unreadable comparison is uncertain, so deploy rather than
  // risk leaving production on stale code.
  const deploy = paths.length === 0 || runtimePaths.length > 0;
  return { deploy, runtimePaths, ignoredPaths };
}

function changedPaths(baseSha, headSha) {
  for (const sha of [baseSha, headSha]) {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
      stdio: "ignore",
    });
  }

  const output = execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", baseSha, headSha],
    { encoding: "utf8" },
  );
  return output.split(/\r?\n/).filter(Boolean);
}

function writeOutputs(result) {
  const lines = [`deploy=${result.deploy}`];
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  } else {
    console.log(lines.join("\n"));
  }
}

export function run(baseSha, headSha) {
  try {
    const result = classifyPaths(changedPaths(baseSha, headSha));
    const reason = result.deploy
      ? result.runtimePaths.length > 0
        ? `runtime changes: ${result.runtimePaths.join(", ")}`
        : "comparison contained no files; deploying fail-open"
      : `non-runtime-only changes: ${result.ignoredPaths.join(", ")}`;
    console.error(`[deployment-policy] ${reason.replace(/[\r\n]/g, " ")}`);
    writeOutputs(result);
  } catch (error) {
    const reason = `classification failed; deploying fail-open: ${error.message}`;
    console.error(`[deployment-policy] ${reason.replace(/[\r\n]/g, " ")}`);
    writeOutputs({ deploy: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , baseSha, headSha] = process.argv;
  if (!baseSha || !headSha) {
    console.error(
      "Usage: node scripts/vercel-deployment-policy.mjs <base> <head>",
    );
    writeOutputs({ deploy: true });
  } else {
    run(baseSha, headSha);
  }
}
