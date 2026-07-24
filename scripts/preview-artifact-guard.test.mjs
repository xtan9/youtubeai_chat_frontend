import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectPreviewEvidence,
  removePreviewStorageStateDirectory,
} from "./preview-artifact-guard.mjs";

const SECRETS = [
  "preview-bypass-secret",
  "preview-user@example.test",
  "preview-<password&\"value'>",
];
const temporaryRoots = [];

async function createTemporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "preview-artifact-guard-"));
  temporaryRoots.push(root);
  return root;
}

async function writeFixture(root, relativePath, contents) {
  const path = join(root, ...relativePath.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  return path;
}

async function baseFixture() {
  const root = await createTemporaryRoot();
  const sourceDir = join(root, "source");
  const evidenceDir = join(root, "evidence");
  const storageStateDirectory = join(
    root,
    "runner-temp",
    "preview-critical-state",
  );
  await writeFixture(sourceDir, "results.xml", "<testsuites tests=\"1\" />");
  await writeFixture(
    sourceDir,
    "artifacts/.last-run.json",
    "{\"status\":\"passed\"}",
  );
  return { root, sourceDir, evidenceDir, storageStateDirectory };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("preview artifact guard", () => {
  it("collects only JUnit, screenshots, and videos", async () => {
    const fixture = await baseFixture();
    await writeFixture(
      fixture.sourceDir,
      "artifacts/critical/test-failed-1.png",
      "safe screenshot",
    );
    await writeFixture(
      fixture.sourceDir,
      "artifacts/critical/video.webm",
      "safe video",
    );
    await writeFixture(
      fixture.sourceDir,
      "artifacts/critical/error-context.md",
      "internal DOM diagnostic",
    );

    await expect(
      collectPreviewEvidence({ ...fixture, secrets: SECRETS }),
    ).resolves.toEqual([
      "artifacts/critical/test-failed-1.png",
      "artifacts/critical/video.webm",
      "results.xml",
    ]);

    await expect(
      readFile(join(fixture.evidenceDir, "results.xml"), "utf8"),
    ).resolves.toContain("testsuites");
    await expect(
      readFile(
        join(fixture.evidenceDir, "artifacts", "critical", "error-context.md"),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(
        join(fixture.evidenceDir, "artifacts", ".last-run.json"),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["standalone trace", "artifacts/critical/trace.zip", "zip"],
    [
      "embedded HTML report",
      "index.html",
      "<script>playwrightReportBase64=\"UEsDBAo\"</script>",
    ],
    [
      "public storage state",
      "artifacts/public-storage-state.json",
      "{\"cookies\":[]}",
    ],
    [
      "authenticated storage state",
      "artifacts/authenticated-storage-state.json",
      "{\"cookies\":[]}",
    ],
    [
      "supplied secret",
      "results.xml",
      `<testsuite error="${SECRETS[2]}" />`,
    ],
    [
      "bypass cookie",
      "results.xml",
      "<testsuite error=\"__vercel_bypass=derived-cookie\" />",
    ],
    [
      "session token",
      "results.xml",
      "<testsuite error=\"session_token=derived-token\" />",
    ],
  ])("rejects an upload tree containing %s", async (_name, path, contents) => {
    const fixture = await baseFixture();
    await writeFixture(fixture.sourceDir, path, contents);

    await expect(
      collectPreviewEvidence({ ...fixture, secrets: SECRETS }),
    ).rejects.toThrow();
  });

  it.each([
    ["percent-encoded secret", encodeURIComponent(SECRETS[1])],
    ["base64 secret", Buffer.from(SECRETS[2]).toString("base64")],
    ["base64url secret", Buffer.from(SECRETS[2]).toString("base64url")],
    [
      "HTML-escaped secret",
      SECRETS[2]
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;"),
    ],
  ])("rejects a supplied %s", async (_name, encodedSecret) => {
    const fixture = await baseFixture();
    await writeFixture(
      fixture.sourceDir,
      "results.xml",
      `<testsuite error="${encodedSecret}" />`,
    );

    await expect(
      collectPreviewEvidence({ ...fixture, secrets: SECRETS }),
    ).rejects.toThrow(/Supplied secret found/);
  });

  it("rejects unknown Playwright output instead of silently omitting it", async () => {
    const fixture = await baseFixture();
    await writeFixture(
      fixture.sourceDir,
      "artifacts/critical/unexpected-network.json",
      "{}",
    );

    await expect(
      collectPreviewEvidence({ ...fixture, secrets: SECRETS }),
    ).rejects.toThrow(/outside the preview evidence allowlist/);
  });

  it("rejects symbolic links anywhere in the Playwright output", async () => {
    const fixture = await baseFixture();
    const target = await writeFixture(
      fixture.root,
      "linked-screenshot.png",
      "safe screenshot",
    );
    const linkPath = join(
      fixture.sourceDir,
      "artifacts",
      "critical",
      "linked-screenshot.png",
    );
    await mkdir(dirname(linkPath), { recursive: true });
    await symlink(target, linkPath, "file");

    await expect(
      collectPreviewEvidence({ ...fixture, secrets: SECRETS }),
    ).rejects.toThrow(/symbolic link/);
  });

  it("rejects collection until the runner storage state is deleted", async () => {
    const fixture = await baseFixture();
    await writeFixture(
      fixture.storageStateDirectory,
      "public-storage-state.json",
      "{\"cookies\":[{\"name\":\"__vercel_bypass\"}]}",
    );
    await writeFixture(
      fixture.storageStateDirectory,
      "authenticated-storage-state.json",
      "{\"cookies\":[{\"value\":\"derived-session\"}]}",
    );

    await expect(
      collectPreviewEvidence({ ...fixture, secrets: SECRETS }),
    ).rejects.toThrow(/directory exists at evidence collection time/);
  });

  it("deletes both storage states inside the runner temporary directory", async () => {
    const root = await createTemporaryRoot();
    const runnerTemp = join(root, "runner-temp");
    const stateDirectory = join(runnerTemp, "preview-critical-state");
    const publicStatePath = await writeFixture(
      stateDirectory,
      "public-storage-state.json",
      "{\"cookies\":[{\"name\":\"__vercel_bypass\"}]}",
    );
    const authenticatedStatePath = await writeFixture(
      stateDirectory,
      "authenticated-storage-state.json",
      "{\"cookies\":[{\"value\":\"session-token\"}]}",
    );

    await expect(
      removePreviewStorageStateDirectory(stateDirectory, runnerTemp),
    ).resolves.toBeUndefined();
    await expect(readFile(publicStatePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(authenticatedStatePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses to delete a storage state directory outside runner temp", async () => {
    const root = await createTemporaryRoot();
    const runnerTemp = join(root, "runner-temp");
    const outsideStateDirectory = join(root, "outside-state");
    const outsideState = await writeFixture(
      outsideStateDirectory,
      "authenticated-storage-state.json",
      "{\"cookies\":[]}",
    );
    await mkdir(runnerTemp, { recursive: true });

    await expect(
      removePreviewStorageStateDirectory(outsideStateDirectory, runnerTemp),
    ).rejects.toThrow(/must be inside/);
    await expect(readFile(outsideState, "utf8")).resolves.toContain("cookies");
  });
});
