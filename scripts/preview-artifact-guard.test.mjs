import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectPreviewEvidence,
  removePreviewStorageState,
} from "./preview-artifact-guard.mjs";

const SECRETS = [
  "preview-bypass-secret",
  "preview-user@example.test",
  "preview-password-value",
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
  const storageStatePath = join(root, "runner-temp", "auth", "state.json");
  await writeFixture(sourceDir, "results.xml", "<testsuites tests=\"1\" />");
  await writeFixture(
    sourceDir,
    "artifacts/.last-run.json",
    "{\"status\":\"passed\"}",
  );
  return { root, sourceDir, evidenceDir, storageStatePath };
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
      "storage state",
      "artifacts/storage-state.json",
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

  it("rejects collection until the runner storage state is deleted", async () => {
    const fixture = await baseFixture();
    await writeFixture(
      dirname(fixture.storageStatePath),
      "state.json",
      "{\"cookies\":[{\"value\":\"derived-session\"}]}",
    );

    await expect(
      collectPreviewEvidence({ ...fixture, secrets: SECRETS }),
    ).rejects.toThrow(/exists at evidence collection time/);
  });

  it("deletes storage state inside the runner temporary directory", async () => {
    const root = await createTemporaryRoot();
    const runnerTemp = join(root, "runner-temp");
    const statePath = await writeFixture(
      runnerTemp,
      "preview-auth/state.json",
      "{\"cookies\":[{\"value\":\"session-token\"}]}",
    );

    await expect(
      removePreviewStorageState(statePath, runnerTemp),
    ).resolves.toBeUndefined();
    await expect(readFile(statePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to delete storage state outside the runner temporary directory", async () => {
    const root = await createTemporaryRoot();
    const runnerTemp = join(root, "runner-temp");
    const outsideState = await writeFixture(
      root,
      "outside-state.json",
      "{\"cookies\":[]}",
    );
    await mkdir(runnerTemp, { recursive: true });

    await expect(
      removePreviewStorageState(outsideState, runnerTemp),
    ).rejects.toThrow(/must be inside/);
    await expect(readFile(outsideState, "utf8")).resolves.toContain("cookies");
  });
});
