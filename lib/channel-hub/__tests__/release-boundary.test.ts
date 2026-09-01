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
  it("keeps the inert experience out of production routes and navigation", () => {
    expect(existsSync(absolute("app/channel"))).toBe(false);

    const imports = productionFiles("app").filter((file) =>
      /(?:from|import\()\s*["'](?:@\/)?components\/channel\/channel-hub(?:-experience)?["']/u.test(
        source(file),
      ),
    );
    expect(imports).toEqual([]);
  });

  it("keeps Summary and History from linking to the public Channel route", () => {
    const routeLinks = [
      ...productionFiles("app/summary"),
      ...productionFiles("app/history"),
    ].filter((file) => /["'`]\/channel(?:["'`?])/u.test(source(file)));

    expect(routeLinks).toEqual([]);
  });
});
