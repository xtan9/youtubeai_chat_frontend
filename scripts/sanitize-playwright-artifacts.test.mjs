import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
  REDACTED,
  assertArtifactTreeHasNoSecrets,
  sanitizeArtifactTree,
} from "./sanitize-playwright-artifacts.mjs";

const localRequire = createRequire(import.meta.url);
const playwrightRequire = createRequire(
  localRequire.resolve("@playwright/test/package.json"),
);
const { yauzl, yazl } = playwrightRequire("playwright-core/lib/zipBundle");

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});
async function createZip(path, entries) {
  const archive = new yazl.ZipFile();
  const output = createWriteStream(path);
  archive.outputStream.pipe(output);
  for (const [name, content] of Object.entries(entries)) {
    archive.addBuffer(Buffer.from(content, "utf8"), name);
  }
  archive.end();
  await finished(output);
}

async function readZip(path) {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (openError, zipFile) => {
      if (openError) {
        reject(openError);
        return;
      }

      const entries = {};
      zipFile.on("error", reject);
      zipFile.on("end", () => resolve(entries));
      zipFile.on("entry", (entry) => {
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            reject(streamError);
            return;
          }
          const chunks = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("error", reject);
          stream.on("end", () => {
            entries[entry.fileName] = Buffer.concat(chunks).toString("utf8");
            zipFile.readEntry();
          });
        });
      });
      zipFile.readEntry();
    });
  });
}

describe("sanitizeArtifactTree", () => {
  it("redacts supplied secrets, derived cookies, credential actions, and session tokens", async () => {
    const root = await mkdtemp(join(tmpdir(), "playwright-redaction-"));
    temporaryRoots.push(root);
    const reportDirectory = join(root, "playwright-report");
    const resultsDirectory = join(root, "test-results");
    await mkdir(reportDirectory);
    await mkdir(resultsDirectory);

    const bypassSecret = 'bypass-"secret';
    const email = "preview-user@example.test";
    const password = "p@ss word/with?symbols";
    const secrets = [bypassSecret, email, password];
    const tracePath = join(resultsDirectory, "trace.zip");

    await createZip(tracePath, {
      "0-trace.trace": [
        JSON.stringify({
          type: "before",
          method: "fill",
          params: { selector: "#password", value: password },
        }),
        JSON.stringify({
          type: "frame-snapshot",
          snapshot: {
            html: ["INPUT", { __playwright_value_: email }],
          },
        }),
      ].join("\n"),
      "0-trace.network": JSON.stringify({
        type: "resource-snapshot",
        snapshot: {
          request: {
            headers: [
              {
                name: "x-vercel-protection-bypass",
                value: bypassSecret,
              },
              {
                name: "cookie",
                value: "__vercel_bypass=derived-cookie-value",
              },
            ],
            cookies: [
              { name: "__vercel_bypass", value: "derived-cookie-value" },
            ],
          },
          response: {
            headers: [
              {
                name: "set-cookie",
                value: "sb-preview-auth-token=derived-session-cookie",
              },
            ],
          },
        },
      }),
      "resources/auth.json": JSON.stringify({
        access_token: "derived-access-token",
        refresh_token: "derived-refresh-token",
        user: { email },
      }),
    });

    await writeFile(
      join(reportDirectory, "report.json"),
      JSON.stringify({
        rawPassword: password,
        encodedPassword: encodeURIComponent(password),
      }),
    );

    await sanitizeArtifactTree(
      [reportDirectory, resultsDirectory],
      secrets,
    );
    await expect(
      assertArtifactTreeHasNoSecrets(
        [reportDirectory, resultsDirectory],
        secrets,
      ),
    ).resolves.toBeUndefined();

    const entries = await readZip(tracePath);
    const traceLines = entries["0-trace.trace"]
      .split("\n")
      .map((line) => JSON.parse(line));
    const network = JSON.parse(entries["0-trace.network"]);
    const auth = JSON.parse(entries["resources/auth.json"]);
    const report = await readFile(
      join(reportDirectory, "report.json"),
      "utf8",
    );

    expect(traceLines[0].params.value).toBe(REDACTED);
    expect(
      traceLines[1].snapshot.html[1].__playwright_value_,
    ).toBe(REDACTED);
    expect(network.snapshot.request.headers[0].value).toBe(REDACTED);
    expect(network.snapshot.request.headers[1].value).toBe(REDACTED);
    expect(network.snapshot.request.cookies[0].value).toBe(REDACTED);
    expect(network.snapshot.response.headers[0].value).toBe(REDACTED);
    expect(auth).toEqual({
      access_token: REDACTED,
      refresh_token: REDACTED,
      user: { email: REDACTED },
    });
    expect(entries["0-trace.network"]).not.toContain("derived-cookie-value");
    expect(entries["resources/auth.json"]).not.toContain(
      "derived-access-token",
    );
    expect(report).not.toContain(password);
    expect(report).not.toContain(encodeURIComponent(password));
  });
});
