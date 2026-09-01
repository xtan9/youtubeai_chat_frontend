import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");

function absolute(relativePath: string): string {
  return path.join(ROOT, relativePath);
}

function source(relativePath: string): string {
  return readFileSync(absolute(relativePath), "utf8");
}

function productionFiles(relativeDirectory: string): string[] {
  const directory = absolute(relativeDirectory);
  const files: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path
      .join(relativeDirectory, entry.name)
      .split(path.sep)
      .join("/");

    if (entry.isDirectory()) {
      files.push(...productionFiles(relativePath));
    } else if (
      /\.(?:ts|tsx)$/u.test(entry.name) &&
      !relativePath.includes("/__tests__/") &&
      !relativePath.endsWith(".test.ts") &&
      !relativePath.endsWith(".test.tsx")
    ) {
      files.push(relativePath);
    }
  }

  return files;
}

describe("Channel Hub release boundary", () => {
  it("exposes the Hub only through the release-gated production route", () => {
    expect(existsSync(absolute("app/channel/page.tsx"))).toBe(true);

    const imports = productionFiles("app").filter((file) =>
      /(?:from|import\()\s*["'](?:@\/)?components\/channel\/channel-hub(?:-experience)?["']/u.test(
        source(file),
      ),
    );
    expect(imports).toEqual(["app/channel/channel-hub-controller.tsx"]);
    expect(source("app/channel/page.tsx")).toContain(
      "evaluateChannelLaunchGate",
    );
    expect(source("app/channel/page.tsx")).toContain(
      "ChannelReleaseBlocked",
    );
  });

  it("links only owner-resolved Summary and History Videos into the Hub", () => {
    expect(source("app/components/history/history-row.tsx")).toContain(
      "buildChannelHubVideoHref",
    );
    expect(source("app/summary/components/channel-video-link.tsx")).toContain(
      "/api/channel/owned-video",
    );
    expect(source("app/api/channel/owned-video/route.ts")).toContain(
      "loadOwnedVideoForUrl",
    );
  });
});
