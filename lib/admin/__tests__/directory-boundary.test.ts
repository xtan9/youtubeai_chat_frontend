import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function walk(relativeDir: string): string[] {
  const absoluteDir = path.join(ROOT, relativeDir);
  const files: string[] = [];
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(relativePath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(relativePath);
    }
  }
  return files;
}

describe("User Account Directory boundaries", () => {
  it("keeps enumeration server-only and out of pages and client components", () => {
    expect(source("lib/admin/user-account-directory.ts")).toMatch(
      /^import "server-only";/m,
    );

    const appImports = walk("app/admin")
      .filter((file) => !file.includes("__tests__"))
      .map((file) => ({ file, contents: source(file) }))
      .filter(({ contents }) => contents.includes("user-account-directory"));

    expect(appImports).toEqual([]);
  });

  it("keeps shell and reconciliation consumers off the retired query exports", () => {
    const shell = source("app/admin/layout.tsx");
    const reconciliation = source("lib/admin/admin-flag-sync.ts");
    const affectedTests = source("lib/admin/__tests__/queries.test.ts");

    expect(shell).toContain("@/lib/admin/admin-shell");
    expect(shell).not.toContain("@/lib/admin/queries");
    expect(reconciliation).toContain("./user-account-directory");
    expect(reconciliation).not.toContain("./queries");
    expect(affectedTests).not.toMatch(/\b(listAllUsers|fetchRegisteredUsersTotal)\b/);
  });
});
