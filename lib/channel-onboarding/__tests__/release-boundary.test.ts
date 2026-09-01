import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");

function walk(relativeDirectory: string): string[] {
  const directory = path.join(ROOT, relativeDirectory);
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(relativePath));
    } else if (/\.(?:ts|tsx)$/u.test(entry.name)) {
      files.push(relativePath);
    }
  }
  return files;
}

function productionFiles(relativeDirectory: string): string[] {
  return walk(relativeDirectory).filter(
    (file) =>
      !file.includes(`${path.sep}__tests__${path.sep}`) &&
      !file.endsWith(".test.ts") &&
      !file.endsWith(".test.tsx"),
  );
}

describe("Channel onboarding release boundary", () => {
  it("keeps onboarding behind the complete Channel launch gate", () => {
    expect(existsSync(path.join(ROOT, "app", "channel", "page.tsx"))).toBe(true);
    const route = readFileSync(path.join(ROOT, "app", "channel", "page.tsx"), "utf8");
    expect(route).toContain("evaluateChannelLaunchGate");
    expect(route).toContain("if (launchGate.status === \"blocked\")");
    expect(route).toContain("ChannelReleaseBlocked");
  });

  it("keeps provider transport and credentials outside the inert contract layer", () => {
    const transportPatterns = [
      /googleapis\.com\/youtube\/v3/iu,
      /google-auth-library/iu,
      /youtube\/v3/iu,
      /YOUTUBE_DATA_API_KEY/u,
      /fetch\s*\(/u,
    ];
    const violations: string[] = [];
    for (const file of productionFiles("lib/channel-onboarding")) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      for (const pattern of transportPatterns) {
        if (pattern.test(source)) violations.push(`${file}: ${pattern}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
