import { readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const localRequire = createRequire(import.meta.url);
const playwrightRequire = createRequire(
  localRequire.resolve("@playwright/test/package.json"),
);
const { yauzl, yazl } = playwrightRequire("playwright-core/lib/zipBundle");

export const REDACTED = "[REDACTED]";

const EMBEDDED_REPORT_MARKER_PATTERN =
  /<template\b[^>]*\bid=(?:"playwrightReportBase64"|'playwrightReportBase64')[^>]*>/gi;
const EMBEDDED_REPORT_PATTERN =
  /(<template\b[^>]*\bid=(?:"playwrightReportBase64"|'playwrightReportBase64')[^>]*>\s*data:application\/zip;base64,)([A-Za-z0-9+/=\r\n]+)(\s*<\/template>)/gi;
const MAX_EMBEDDED_REPORT_DEPTH = 4;

const SENSITIVE_FIELD_NAMES = new Set([
  "__playwright_value_",
  "access_token",
  "authorization",
  "cookie",
  "email",
  "id_token",
  "password",
  "refresh_token",
  "secret",
  "session_token",
  "set-cookie",
  "token",
]);

const SENSITIVE_NAME_FRAGMENTS = [
  "__vercel_bypass",
  "authorization",
  "auth-token",
  "cookie",
  "protection-bypass",
  "refresh-token",
  "session",
];

function isSensitiveFieldName(name) {
  return SENSITIVE_FIELD_NAMES.has(name.toLowerCase());
}

function isSensitiveNamedValue(name) {
  const normalized = name.toLowerCase();
  return SENSITIVE_NAME_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment),
  );
}

function htmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function secretVariants(secrets) {
  const variants = new Set();

  for (const secret of secrets) {
    if (!secret) continue;
    variants.add(secret);
    variants.add(JSON.stringify(secret).slice(1, -1));
    variants.add(encodeURIComponent(secret));
    variants.add(Buffer.from(secret, "utf8").toString("base64"));
    variants.add(
      Buffer.from(secret, "utf8")
        .toString("base64url"),
    );
    variants.add(htmlEscape(secret));
  }

  return [...variants]
    .filter((value) => value.length >= 4)
    .sort((left, right) => right.length - left.length);
}

function redactKnownSecrets(text, variants) {
  let sanitized = text;
  for (const variant of variants) {
    sanitized = sanitized.replaceAll(variant, REDACTED);
  }
  return sanitized;
}

function sanitizeJsonValue(value, variants) {
  if (typeof value === "string") {
    return sanitizeFallbackText(value, variants);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonValue(item, variants));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized = {};
  for (const [key, child] of Object.entries(value)) {
    sanitized[key] = isSensitiveFieldName(key)
      ? REDACTED
      : sanitizeJsonValue(child, variants);
  }

  if (
    typeof sanitized.name === "string" &&
    "value" in sanitized &&
    isSensitiveNamedValue(sanitized.name)
  ) {
    sanitized.value = REDACTED;
  }

  if (
    typeof sanitized.method === "string" &&
    ["fill", "type", "pressSequentially"].includes(sanitized.method) &&
    sanitized.params &&
    typeof sanitized.params === "object"
  ) {
    for (const field of ["text", "value"]) {
      if (field in sanitized.params) sanitized.params[field] = REDACTED;
    }
  }

  return sanitized;
}

function trySanitizeJsonText(text, variants) {
  try {
    return JSON.stringify(sanitizeJsonValue(JSON.parse(text), variants));
  } catch {
    // Playwright's .trace and .network files are newline-delimited JSON.
  }

  const lines = text.split(/\r?\n/);
  let parsedLine = false;
  const sanitizedLines = lines.map((line) => {
    if (!line.trim()) return line;
    try {
      parsedLine = true;
      return JSON.stringify(sanitizeJsonValue(JSON.parse(line), variants));
    } catch {
      return sanitizeFallbackText(line, variants);
    }
  });

  return parsedLine ? sanitizedLines.join("\n") : null;
}

function sanitizeFallbackText(text, variants) {
  return redactKnownSecrets(text, variants)
    .replace(
      /((?:__vercel_bypass|(?:x-vercel-)?protection-bypass)=)[^;\s"'\\]+/gi,
      `$1${REDACTED}`,
    )
    .replace(
      /("(?:access_token|authorization|cookie|email|id_token|password|refresh_token|secret|session_token|set-cookie|token)"\s*:\s*)"((?:\\.|[^"\\])*)"/gi,
      `$1"${REDACTED}"`,
    );
}

function isUtf8Text(buffer) {
  if (buffer.includes(0)) return false;
  const decoded = buffer.toString("utf8");
  return Buffer.from(decoded, "utf8").equals(buffer);
}

function replaceBuffer(buffer, search, replacement) {
  const parts = [];
  let cursor = 0;
  let index = buffer.indexOf(search, cursor);

  while (index !== -1) {
    parts.push(buffer.subarray(cursor, index), replacement);
    cursor = index + search.length;
    index = buffer.indexOf(search, cursor);
  }

  if (!parts.length) return buffer;
  parts.push(buffer.subarray(cursor));
  return Buffer.concat(parts);
}

export function sanitizeBuffer(buffer, secrets) {
  const variants = secretVariants(secrets);
  let sanitized = buffer;
  const replacement = Buffer.from(REDACTED, "utf8");

  for (const variant of variants) {
    sanitized = replaceBuffer(
      sanitized,
      Buffer.from(variant, "utf8"),
      replacement,
    );
  }

  if (!isUtf8Text(sanitized)) return sanitized;

  const text = sanitized.toString("utf8");
  const structured = trySanitizeJsonText(text, variants);
  return Buffer.from(
    structured ?? sanitizeFallbackText(text, variants),
    "utf8",
  );
}

function collectZipEntries(openZip) {
  return new Promise((resolvePromise, reject) => {
    openZip((openError, zipFile) => {
      if (openError) {
        reject(openError);
        return;
      }

      const entries = [];
      zipFile.on("error", reject);
      zipFile.on("end", () => resolvePromise(entries));
      zipFile.on("entry", (entry) => {
        if (entry.fileName.endsWith("/")) {
          zipFile.readEntry();
          return;
        }

        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            reject(streamError);
            return;
          }

          const chunks = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("error", reject);
          stream.on("end", () => {
            entries.push({
              fileName: entry.fileName,
              buffer: Buffer.concat(chunks),
            });
            zipFile.readEntry();
          });
        });
      });
      zipFile.readEntry();
    });
  });
}

async function readZipEntries(zipPath) {
  return collectZipEntries((callback) =>
    yauzl.open(zipPath, { lazyEntries: true }, callback),
  );
}

async function readZipEntriesFromBuffer(buffer) {
  return collectZipEntries((callback) =>
    yauzl.fromBuffer(buffer, { lazyEntries: true }, callback),
  );
}

async function writeZipEntriesToBuffer(entries) {
  const archive = new yazl.ZipFile();
  const chunks = [];
  const outputComplete = new Promise((resolvePromise, reject) => {
    archive.outputStream.on("data", (chunk) => chunks.push(chunk));
    archive.outputStream.on("error", reject);
    archive.outputStream.on("end", resolvePromise);
  });

  for (const entry of entries) {
    archive.addBuffer(entry.buffer, entry.fileName);
  }
  archive.end();
  await outputComplete;
  return Buffer.concat(chunks);
}

async function writeZipEntries(zipPath, entries) {
  const temporaryPath = `${zipPath}.sanitized`;
  try {
    await writeFile(
      temporaryPath,
      await writeZipEntriesToBuffer(entries),
      { flag: "wx" },
    );
    await rename(temporaryPath, zipPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function listFiles(root) {
  try {
    const metadata = await stat(root);
    if (metadata.isFile()) return [root];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    if (entry.isFile()) files.push(path);
  }
  return files;
}

function embeddedReportMatches(text, location) {
  const markers = [...text.matchAll(EMBEDDED_REPORT_MARKER_PATTERN)];
  const reports = [...text.matchAll(EMBEDDED_REPORT_PATTERN)];
  if (markers.length !== reports.length) {
    throw new Error(
      `Unable to parse embedded Playwright report in ${location}`,
    );
  }
  return reports;
}

function decodeBase64Archive(value, location) {
  const normalized = value.replace(/\s/g, "");
  const archive = Buffer.from(normalized, "base64");
  if (
    !normalized ||
    archive
      .toString("base64")
      .replace(/=+$/, "") !== normalized.replace(/=+$/, "")
  ) {
    throw new Error(`Invalid embedded Playwright report Base64 in ${location}`);
  }
  return archive;
}

async function sanitizeEmbeddedReports(buffer, secrets, location, depth = 0) {
  if (!isUtf8Text(buffer)) return { buffer, zipEntries: 0 };
  if (depth > MAX_EMBEDDED_REPORT_DEPTH) {
    throw new Error(`Embedded Playwright report nesting is too deep in ${location}`);
  }

  const text = buffer.toString("utf8");
  const reports = embeddedReportMatches(text, location);
  if (!reports.length) return { buffer, zipEntries: 0 };

  const output = [];
  let cursor = 0;
  let zipEntries = 0;

  for (const report of reports) {
    output.push(text.slice(cursor, report.index), report[1]);
    const entries = await readZipEntriesFromBuffer(
      decodeBase64Archive(report[2], location),
    );
    const sanitizedEntries = [];

    for (const entry of entries) {
      const sanitized = sanitizeBuffer(entry.buffer, secrets);
      const nested = await sanitizeEmbeddedReports(
        sanitized,
        secrets,
        `${location}:${entry.fileName}`,
        depth + 1,
      );
      sanitizedEntries.push({ ...entry, buffer: nested.buffer });
      zipEntries += nested.zipEntries;
    }

    output.push(
      (await writeZipEntriesToBuffer(sanitizedEntries)).toString("base64"),
      report[3],
    );
    zipEntries += entries.length;
    cursor = report.index + report[0].length;
  }

  output.push(text.slice(cursor));
  return { buffer: Buffer.from(output.join(""), "utf8"), zipEntries };
}

async function sanitizeZip(zipPath, secrets) {
  const entries = await readZipEntries(zipPath);
  const sanitizedEntries = [];
  let embeddedZipEntries = 0;

  for (const entry of entries) {
    const sanitized = sanitizeBuffer(entry.buffer, secrets);
    const embedded = await sanitizeEmbeddedReports(
      sanitized,
      secrets,
      `${zipPath}:${entry.fileName}`,
    );
    sanitizedEntries.push({ ...entry, buffer: embedded.buffer });
    embeddedZipEntries += embedded.zipEntries;
  }

  await writeZipEntries(zipPath, sanitizedEntries);
  return { zipEntries: entries.length, embeddedZipEntries };
}

export async function sanitizeArtifactTree(roots, secrets) {
  let files = 0;
  let zipEntries = 0;
  let embeddedZipEntries = 0;

  for (const root of roots) {
    for (const path of await listFiles(root)) {
      files += 1;
      if (path.toLowerCase().endsWith(".zip")) {
        const sanitized = await sanitizeZip(path, secrets);
        zipEntries += sanitized.zipEntries;
        embeddedZipEntries += sanitized.embeddedZipEntries;
        continue;
      }

      const original = await readFile(path);
      const plain = sanitizeBuffer(original, secrets);
      const embedded = await sanitizeEmbeddedReports(
        plain,
        secrets,
        path,
      );
      embeddedZipEntries += embedded.zipEntries;
      if (!embedded.buffer.equals(original)) {
        await writeFile(path, embedded.buffer);
      }
    }
  }

  return { files, zipEntries, embeddedZipEntries };
}

function assertBufferHasNoSecrets(buffer, secrets, location) {
  for (const variant of secretVariants(secrets)) {
    if (buffer.includes(Buffer.from(variant, "utf8"))) {
      throw new Error(`Secret material remains in ${location}`);
    }
  }

  if (!isUtf8Text(buffer)) return;

  const text = buffer.toString("utf8");
  const values = [];
  try {
    values.push(JSON.parse(text));
  } catch {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        values.push(JSON.parse(line));
      } catch {
        // Non-JSON report assets were already checked for supplied secrets.
      }
    }
  }

  const assertSanitizedValue = (value) => {
    if (Array.isArray(value)) {
      value.forEach(assertSanitizedValue);
      return;
    }
    if (!value || typeof value !== "object") return;

    for (const [key, child] of Object.entries(value)) {
      if (isSensitiveFieldName(key) && child !== REDACTED) {
        throw new Error(`Sensitive field remains in ${location}`);
      }
      assertSanitizedValue(child);
    }

    if (
      typeof value.name === "string" &&
      "value" in value &&
      isSensitiveNamedValue(value.name) &&
      value.value !== REDACTED
    ) {
      throw new Error(`Sensitive named value remains in ${location}`);
    }

    if (
      typeof value.method === "string" &&
      ["fill", "type", "pressSequentially"].includes(value.method) &&
      value.params &&
      typeof value.params === "object"
    ) {
      for (const field of ["text", "value"]) {
        if (field in value.params && value.params[field] !== REDACTED) {
          throw new Error(`Credential action value remains in ${location}`);
        }
      }
    }
  };

  values.forEach(assertSanitizedValue);
}

async function assertZipHasNoSecrets(zipPath, secrets) {
  for (const entry of await readZipEntries(zipPath)) {
    assertBufferHasNoSecrets(
      entry.buffer,
      secrets,
      `${zipPath}:${entry.fileName}`,
    );
    await assertEmbeddedReportsHaveNoSecrets(
      entry.buffer,
      secrets,
      `${zipPath}:${entry.fileName}`,
    );
  }
}

async function assertEmbeddedReportsHaveNoSecrets(
  buffer,
  secrets,
  location,
  depth = 0,
) {
  if (!isUtf8Text(buffer)) return;
  if (depth > MAX_EMBEDDED_REPORT_DEPTH) {
    throw new Error(`Embedded Playwright report nesting is too deep in ${location}`);
  }

  const text = buffer.toString("utf8");
  for (const report of embeddedReportMatches(text, location)) {
    const entries = await readZipEntriesFromBuffer(
      decodeBase64Archive(report[2], location),
    );
    for (const entry of entries) {
      const entryLocation = `${location}:${entry.fileName}`;
      assertBufferHasNoSecrets(entry.buffer, secrets, entryLocation);
      await assertEmbeddedReportsHaveNoSecrets(
        entry.buffer,
        secrets,
        entryLocation,
        depth + 1,
      );
    }
  }
}

export async function assertArtifactTreeHasNoSecrets(roots, secrets) {
  for (const root of roots) {
    for (const path of await listFiles(root)) {
      if (path.toLowerCase().endsWith(".zip")) {
        await assertZipHasNoSecrets(path, secrets);
      } else {
        const buffer = await readFile(path);
        assertBufferHasNoSecrets(buffer, secrets, path);
        await assertEmbeddedReportsHaveNoSecrets(buffer, secrets, path);
      }
    }
  }
}

async function main() {
  const secrets = [
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    process.env.PREVIEW_TEST_USER_EMAIL,
    process.env.PREVIEW_TEST_USER_PASSWORD,
  ];
  if (secrets.some((value) => !value)) {
    throw new Error("All preview-only secrets are required for redaction");
  }

  const roots =
    process.argv.length > 2
      ? process.argv.slice(2).map((path) => resolve(path))
      : ["playwright-report", "test-results"].map((path) => resolve(path));

  const result = await sanitizeArtifactTree(roots, secrets);
  await assertArtifactTreeHasNoSecrets(roots, secrets);
  console.log(
    `Sanitized ${result.files} Playwright artifact files ` +
      `(${result.zipEntries} standalone and ` +
      `${result.embeddedZipEntries} embedded archive entries)`,
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
