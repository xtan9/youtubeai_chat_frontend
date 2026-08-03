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

describe("Dashboard Report boundaries", () => {
  it("keeps the loader server-only and the route at one loader boundary", () => {
    const loader = source("lib/admin/dashboard-report.ts");
    const page = source("app/admin/page.tsx");

    expect(loader).toMatch(/^import "server-only";/m);
    expect(page).toContain("@/lib/admin/dashboard-report");
    expect(page).not.toContain("@/lib/admin/queries");
    expect(page).not.toMatch(/\b(getDashboardKPIs|listAdminUserIds|lastNDays)\b/);
    expect(page.match(/\bloadDashboardReport\(/g)).toHaveLength(1);
  });

  it("keeps Dashboard production code and tests off the retired query surface", () => {
    const dashboardFiles = [
      "app/admin/page.tsx",
      "app/admin/_components/report-completeness.tsx",
      "app/admin/_components/__tests__/report-completeness.test.tsx",
      "lib/admin/dashboard-report.ts",
      "lib/admin/__tests__/dashboard-report.test.ts",
    ];

    for (const file of dashboardFiles) {
      const contents = source(file);
      expect(contents, file).not.toContain("@/lib/admin/queries");
      expect(contents, file).not.toContain("../queries");
      expect(contents, file).not.toContain("getDashboardKPIs");
    }
  });
});

describe("Videos Report boundaries", () => {
  it("keeps the loader server-only and the route at one loader boundary", () => {
    const loader = source("lib/admin/videos-report.ts");
    const page = source("app/admin/videos/page.tsx");

    expect(loader).toMatch(/^import "server-only";/m);
    expect(page).toContain("@/lib/admin/videos-report");
    expect(page).not.toContain("@/lib/admin/queries");
    expect(page).not.toMatch(
      /\b(listVideosWithStats|getVideoInsights|listAdminUserIdsWithStatus|lastNDays)\b/,
    );
    expect(page.match(/\bloadVideosReport\(/g)).toHaveLength(1);
  });

  it("keeps Videos production code and tests off the retired query surface", () => {
    const videosFiles = [
      "app/admin/videos/page.tsx",
      "app/admin/videos/_components/filter.ts",
      "app/admin/videos/_components/videos-insights.tsx",
      "app/admin/videos/_components/videos-table.tsx",
      "app/admin/videos/_components/video-row-expansion.tsx",
      "lib/admin/videos-report.ts",
      "lib/admin/__tests__/videos-report.test.ts",
    ];

    for (const file of videosFiles) {
      const contents = source(file);
      expect(contents, file).not.toContain("@/lib/admin/queries");
      expect(contents, file).not.toContain("../queries");
      expect(contents, file).not.toContain("listVideosWithStats");
      expect(contents, file).not.toContain("getVideoInsights");
    }
  });
});

describe("User Accounts Report boundaries", () => {
  it("keeps the report server-only and the route at one loader boundary", () => {
    const loader = source("lib/admin/user-accounts-report.ts");
    const page = source("app/admin/users/page.tsx");

    expect(loader).toMatch(/^import "server-only";/m);
    expect(page).toContain("@/lib/admin/user-accounts-report");
    expect(page).not.toContain("@/lib/admin/queries");
    expect(page).not.toMatch(
      /\b(listUsersWithStatsAndSort|getUserSummaries|getUserAuditEvents|lastNDays)\b/,
    );
    expect(page.match(/\bloadUserAccountsReport\(/g)).toHaveLength(1);
  });

  it("keeps User Accounts production code and tests on cohesive report types", () => {
    const userAccountsFiles = [
      "app/admin/users/page.tsx",
      "app/admin/users/_components/filter.ts",
      "app/admin/users/_components/users-table.tsx",
      "app/admin/users/_components/__tests__/filter.test.ts",
      "app/admin/users/_components/__tests__/users-table.test.tsx",
      "lib/admin/user-accounts-report.ts",
      "lib/admin/__tests__/user-accounts-report.test.ts",
    ];

    for (const file of userAccountsFiles) {
      const contents = source(file);
      expect(contents, file).not.toContain("@/lib/admin/queries");
      expect(contents, file).not.toContain("../queries");
      expect(contents, file).not.toContain("@/lib/admin/audit-report");
      expect(contents, file).not.toMatch(
        /\b(listUsersWithStatsAndSort|getUserSummaries|getUserAuditEvents)\b/,
      );
    }
  });
});
