import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

function absolute(relativePath: string): string {
  return path.join(ROOT, relativePath);
}

function source(relativePath: string): string {
  return readFileSync(absolute(relativePath), "utf8");
}

function walk(relativeDir: string): string[] {
  const directory = absolute(relativeDir);
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path
      .join(relativeDir, entry.name)
      .split(path.sep)
      .join("/");
    if (entry.isDirectory()) {
      files.push(...walk(relativePath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(relativePath);
    }
  }
  return files;
}

function productionFiles(relativeDir: string): string[] {
  return walk(relativeDir).filter(
    (file) =>
      !file.includes("/__tests__/") &&
      !file.endsWith(".test.ts") &&
      !file.endsWith(".test.tsx"),
  );
}

describe("Channel tracer release boundary", () => {
  it("keeps the offline tracer out of production routes and navigation", () => {
    expect(existsSync(absolute("app/channel"))).toBe(false);

    const productionConsumers = [
      ...productionFiles("app"),
      ...productionFiles("components"),
    ];
    const channelImports = productionConsumers.filter((file) =>
      /(?:from|import\()\s*["'](?:@\/)?lib\/channel\//.test(source(file)),
    );
    expect(channelImports).toEqual([]);
  });

  it("keeps provider transport and OAuth configuration out of the tracer implementation", () => {
    const tracerFiles = productionFiles("lib/channel");
    const transportPatterns = [
      /googleapis\.com/i,
      /google-auth-library/i,
      /youtube\/v3/i,
      /YOUTUBE_DATA_API_KEY/,
      /fetch\s*\(/,
      /oauth/i,
    ];

    const violations: string[] = [];
    for (const file of tracerFiles) {
      const contents = source(file);
      for (const pattern of transportPatterns) {
        if (pattern.test(contents)) violations.push(`${file}: ${pattern}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
