import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

const INTERNAL_ONLY_FILES = new Set([
  "artifacts/.last-run.json",
]);
const INTERNAL_ONLY_BASENAMES = new Set([
  "error-context.md",
]);
const EVIDENCE_EXTENSIONS = new Set([".png", ".webm"]);
const FORBIDDEN_PATH_PATTERNS = [
  /(?:^|\/)trace(?:\.zip)?$/i,
  /(?:^|\/)index\.html$/i,
  /(?:^|\/)(?:.*[-_.])?storage[-_.]?state(?:[-_.].*)?\.json$/i,
  /\.zip$/i,
];
const FORBIDDEN_CONTENT_MARKERS = [
  "__vercel_bypass",
  "__vercel_live_token",
  "_vercel_jwt",
  "x-vercel-protection-bypass",
  "playwrightreportbase64",
  "access_token",
  "refresh_token",
  "session_token",
  "auth-token",
];

function assertDescendant(childPath, parentPath, label) {
  const child = resolve(childPath);
  const parent = resolve(parentPath);
  const childRelative = relative(parent, child);

  if (
    !childRelative ||
    childRelative === ".." ||
    childRelative.startsWith(`..${sep}`) ||
    isAbsolute(childRelative)
  ) {
    throw new Error(`${label} must be inside ${parent}`);
  }

  return child;
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function listFiles(root) {
  const rootStats = await lstat(root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(`Refusing non-directory artifact root: ${root}`);
  }

  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const relativePath = relative(root, absolutePath).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) {
        throw new Error(`Refusing symbolic link in artifact tree: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Refusing non-file artifact: ${relativePath}`);
      }
      files.push({ absolutePath, relativePath });
    }
  }

  await visit(root);
  return files;
}

function secretVariants(secret) {
  const variants = new Set();
  const add = (value) => {
    if (value) {
      variants.add(value);
    }
  };

  add(secret);
  add(JSON.stringify(secret).slice(1, -1));
  add(encodeURIComponent(secret));
  add(Buffer.from(secret, "utf8").toString("base64"));
  add(
    Buffer.from(secret, "utf8")
      .toString("base64url"),
  );
  add(
    secret
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;"),
  );

  return [...variants];
}

function scanBuffer(buffer, relativePath, secrets) {
  for (const secret of secrets) {
    for (const variant of secretVariants(secret)) {
      if (buffer.includes(Buffer.from(variant, "utf8"))) {
        throw new Error(`Supplied secret found in artifact: ${relativePath}`);
      }
    }
  }

  const lowerCaseBuffer = Buffer.from(buffer.toString("latin1").toLowerCase());
  for (const marker of FORBIDDEN_CONTENT_MARKERS) {
    if (lowerCaseBuffer.includes(Buffer.from(marker))) {
      throw new Error(
        `Credential or captured-session marker found in artifact: ${relativePath}`,
      );
    }
  }
}

function classifySourceFile(relativePath) {
  if (FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(relativePath))) {
    throw new Error(`Forbidden preview artifact: ${relativePath}`);
  }

  if (relativePath === "results.xml") {
    return "evidence";
  }
  if (INTERNAL_ONLY_FILES.has(relativePath)) {
    return "internal";
  }

  const parts = relativePath.split("/");
  const basename = parts.at(-1);
  if (
    parts[0] === "artifacts" &&
    INTERNAL_ONLY_BASENAMES.has(basename)
  ) {
    return "internal";
  }

  const extension = basename?.slice(basename.lastIndexOf(".")).toLowerCase();
  if (
    parts[0] === "artifacts" &&
    EVIDENCE_EXTENSIONS.has(extension)
  ) {
    return "evidence";
  }

  throw new Error(`Artifact is outside the preview evidence allowlist: ${relativePath}`);
}

export async function removePreviewStorageStateDirectory(
  storageStateDirectory,
  runnerTemp,
) {
  const stateDirectory = assertDescendant(
    storageStateDirectory,
    runnerTemp,
    "Preview storage state directory",
  );

  if (await pathExists(stateDirectory)) {
    const stateStats = await lstat(stateDirectory);
    if (stateStats.isSymbolicLink() || !stateStats.isDirectory()) {
      throw new Error(
        `Refusing non-directory preview storage state root: ${stateDirectory}`,
      );
    }
    await rm(stateDirectory, { recursive: true, force: true });
  }
  if (await pathExists(stateDirectory)) {
    throw new Error(
      `Preview storage state directory still exists after cleanup: ${stateDirectory}`,
    );
  }
}

export async function collectPreviewEvidence({
  sourceDir,
  evidenceDir,
  storageStateDirectory,
  secrets,
}) {
  const sourceRoot = resolve(sourceDir);
  const evidenceRoot = resolve(evidenceDir);

  if (await pathExists(storageStateDirectory)) {
    throw new Error(
      `Preview storage state directory exists at evidence collection time: ${storageStateDirectory}`,
    );
  }
  if (!(await pathExists(sourceRoot))) {
    throw new Error(`Preview output directory does not exist: ${sourceRoot}`);
  }

  await mkdir(evidenceRoot, { recursive: true });
  const existingEvidence = await readdir(evidenceRoot);
  if (existingEvidence.length > 0) {
    throw new Error(`Preview evidence directory is not empty: ${evidenceRoot}`);
  }

  const sourceFiles = await listFiles(sourceRoot);
  let junitCount = 0;

  for (const file of sourceFiles) {
    const disposition = classifySourceFile(file.relativePath);
    const contents = await readFile(file.absolutePath);
    scanBuffer(contents, file.relativePath, secrets);

    if (file.relativePath === "results.xml") {
      junitCount += 1;
    }
    if (disposition === "internal") {
      continue;
    }

    const destination = join(evidenceRoot, file.relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(file.absolutePath, destination);
  }

  if (junitCount !== 1) {
    throw new Error(
      `Expected exactly one JUnit result, found ${junitCount}`,
    );
  }

  const evidenceFiles = await listFiles(evidenceRoot);
  for (const file of evidenceFiles) {
    if (classifySourceFile(file.relativePath) !== "evidence") {
      throw new Error(`Unexpected collected evidence: ${file.relativePath}`);
    }
    scanBuffer(await readFile(file.absolutePath), file.relativePath, secrets);
  }

  return evidenceFiles.map((file) => file.relativePath);
}

function requireSecret(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required to verify preview evidence`);
  }
  return value;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "cleanup" && args.length === 2) {
    await removePreviewStorageStateDirectory(args[0], args[1]);
    return;
  }
  if (command === "collect" && args.length === 3) {
    const files = await collectPreviewEvidence({
      sourceDir: args[0],
      evidenceDir: args[1],
      storageStateDirectory: args[2],
      secrets: [
        requireSecret("VERCEL_AUTOMATION_BYPASS_SECRET"),
        requireSecret("PREVIEW_TEST_USER_EMAIL"),
        requireSecret("PREVIEW_TEST_USER_PASSWORD"),
      ],
    });
    process.stdout.write(`Collected ${files.length} allowlisted evidence files\n`);
    return;
  }

  throw new Error(
    "Usage: preview-artifact-guard.mjs cleanup <state-directory> <runner-temp> | collect <source> <evidence> <state-directory>",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
