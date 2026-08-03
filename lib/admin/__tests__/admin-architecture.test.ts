import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const THIS_TEST = "lib/admin/__tests__/admin-architecture.test.ts";

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
    (file) => !file.includes("/__tests__/") && !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"),
  );
}

const REPORTS = [
  {
    label: "Dashboard",
    route: "app/admin/page.tsx",
    module: "lib/admin/dashboard-report.ts",
    loader: "loadDashboardReport",
  },
  {
    label: "Performance",
    route: "app/admin/performance/page.tsx",
    module: "lib/admin/performance-report.ts",
    loader: "loadPerformanceReport",
  },
  {
    label: "User Accounts",
    route: "app/admin/users/page.tsx",
    module: "lib/admin/user-accounts-report.ts",
    loader: "loadUserAccountsReport",
  },
  {
    label: "Videos",
    route: "app/admin/videos/page.tsx",
    module: "lib/admin/videos-report.ts",
    loader: "loadVideosReport",
  },
  {
    label: "Audit",
    route: "app/admin/audit/page.tsx",
    module: "lib/admin/audit-report.ts",
    loader: "loadAuditReport",
  },
  {
    label: "Admin Shell",
    route: "app/admin/layout.tsx",
    module: "lib/admin/admin-shell.ts",
    loader: "loadAdminShell",
  },
] as const;

const CLIENT_SAFE_ADMIN_IMPORTS = [
  "@/lib/admin/admin-constants",
  "@/lib/admin/report-completeness",
  "@/lib/admin/report-types",
  "@/lib/admin/types",
] as const;

const REPORT_INTERNAL_IMPORTS = [
  "@/lib/admin/admin-flag-sync",
  "@/lib/admin/admin-shell",
  "@/lib/admin/audit",
  "@/lib/admin/audit-report",
  "@/lib/admin/audit-row",
  "@/lib/admin/errors",
  "@/lib/admin/performance-report",
  "@/lib/admin/dashboard-report",
  "@/lib/admin/user-accounts-report",
  "@/lib/admin/user-account-directory",
  "@/lib/admin/videos-report",
] as const;

const DISCLOSURE_IMPORTS = [
  "@/lib/services/transcript-disclosure",
  "@/lib/services/video-user-disclosure",
] as const;

const RETIRED_QUERY_PATTERNS = [
  /@\/lib\/admin\/queries/,
  /lib\/admin\/queries/,
  /\.\.\/queries(?:["'])/,
  /\b(?:listVideosWithStats|getVideoInsights|listAdminUserIdsWithStatus|listAdminUserIds)\b/,
];

function hasImportFrom(contents: string, moduleName: string): boolean {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:from|import\\()\\s*["']${escaped}["']`).test(contents);
}

describe("Admin report architecture", () => {
  it("keeps every page-facing report server-only and at exactly one route boundary", () => {
    for (const report of REPORTS) {
      const loader = source(report.module);
      const route = source(report.route);

      expect(loader, report.module).toMatch(/^import "server-only";/m);
      expect(route, report.route).toContain(`@/${report.module.replace(/\.ts$/, "")}`);
      expect(route, report.route).toContain("requireAdminPage");
      expect(route, report.route).toContain("requireAdminClient");
      expect(route.match(new RegExp(`\\b${report.loader}\\(`)), report.route).toHaveLength(1);

      const reportImports = REPORTS.filter(({ module }) =>
        hasImportFrom(route, `@/${module.replace(/\.ts$/, "")}`),
      );
      expect(reportImports.map(({ label }) => label), report.route).toEqual([report.label]);
    }

    const routeByReportModule = new Map(REPORTS.map(({ module, route }) => [`@/${module.replace(/\.ts$/, "")}`, route]));
    const reportImportViolations: string[] = [];
    for (const file of productionFiles("app/admin")) {
      const contents = source(file);
      for (const [moduleName, route] of routeByReportModule) {
        if (hasImportFrom(contents, moduleName) && file !== route) {
          reportImportViolations.push(`${file} imports ${moduleName}; only ${route} may import it`);
        }
      }
    }
    expect(reportImportViolations).toEqual([]);
  });

  it("marks report and query internals as server-only", () => {
    const serverOnlyModules = [
      ...REPORTS.map(({ module }) => module),
      "lib/admin/user-account-directory.ts",
      "lib/admin/admin-flag-sync.ts",
      "lib/admin/audit.ts",
      "lib/admin/audit-row.ts",
      "lib/admin/errors.ts",
    ];

    for (const serverOnlyModule of serverOnlyModules) {
      expect(source(serverOnlyModule), serverOnlyModule).toMatch(/^import "server-only";/m);
    }
  });

  it("keeps client components on serializable admin contracts only", () => {
    const violations: string[] = [];
    for (const file of productionFiles("app/admin")) {
      const contents = source(file);
      if (!contents.match(/^"use client";/m)) continue;

      for (const moduleName of REPORT_INTERNAL_IMPORTS) {
        if (hasImportFrom(contents, moduleName)) {
          violations.push(`${file} imports ${moduleName}`);
        }
      }

      for (const line of contents.split("\n")) {
        const match = line.match(/(?:from|import\()\s*["'](@\/lib\/admin\/[^"']+)["']/);
        if (match && !CLIENT_SAFE_ADMIN_IMPORTS.includes(match[1] as (typeof CLIENT_SAFE_ADMIN_IMPORTS)[number])) {
          violations.push(`${file} imports ${match[1]}`);
        }
      }
    }

    expect([...new Set(violations)]).toEqual([]);
  });

  it("keeps the Directory, flag reconciliation, and audited disclosures narrow", () => {
    const appFiles = productionFiles("app/admin");

    const directoryConsumers = appFiles.filter((file) =>
      hasImportFrom(source(file), "@/lib/admin/user-account-directory"),
    );
    expect(directoryConsumers).toEqual([]);

    const reconciliationConsumers = appFiles.filter((file) =>
      hasImportFrom(source(file), "@/lib/admin/admin-flag-sync"),
    );
    expect(reconciliationConsumers).toEqual(["app/admin/layout.tsx"]);

    const auditCallers = appFiles.filter((file) =>
      hasImportFrom(source(file), "@/lib/admin/audit"),
    );
    expect(auditCallers).toEqual([
      "app/admin/users/_actions/view-transcript.ts",
      "app/admin/videos/_actions/view-video-summary.ts",
      "app/admin/videos/_actions/view-video-transcript.ts",
      "app/admin/videos/_actions/view-video-users.ts",
    ]);

    const disclosureCallers = appFiles.filter((file) =>
      DISCLOSURE_IMPORTS.some((moduleName) => hasImportFrom(source(file), moduleName)),
    );
    expect(disclosureCallers).toEqual([
      "app/admin/users/_actions/view-transcript.ts",
      "app/admin/videos/_actions/view-video-transcript.ts",
      "app/admin/videos/_actions/view-video-users.ts",
    ]);

    const routeFiles = REPORTS.map(({ route }) => route);
    for (const file of routeFiles) {
      const contents = source(file);
      expect(contents, file).not.toMatch(/@\/lib\/admin\/(?:audit["']|audit-row|errors|user-account-directory)/);
      expect(contents, file).not.toMatch(/\b(?:SupabaseClient|QueryError|listUserAccounts)\b/);
    }
  });

  it("renders completeness warnings on every affected report surface", () => {
    expect(source("app/admin/page.tsx")).toContain("ReportCompletenessNotice");
    expect(source("app/admin/performance/page.tsx")).toContain("ReportCompletenessNotice");
    expect(source("app/admin/users/_components/users-table.tsx")).toContain("ReportCompletenessNotice");
    expect(source("app/admin/videos/page.tsx")).toContain("ReportCompletenessNotice");
    expect(source("app/admin/layout.tsx")).toContain("completenessWarnings");
    expect(source("app/admin/_components/topbar.tsx")).toContain("ReportCompletenessNotice");
  });

  it("has no retired query module, monolithic suite, or production/test references", () => {
    expect(existsSync(absolute("lib/admin/queries.ts"))).toBe(false);
    expect(existsSync(absolute("lib/admin/__tests__/queries.test.ts"))).toBe(false);

    const files = [...productionFiles("app"), ...productionFiles("lib"), ...productionFiles("components"), ...walk("lib/admin/__tests__")]
      .filter((file) => file !== THIS_TEST);
    const violations: string[] = [];
    for (const file of files) {
      const contents = source(file);
      for (const pattern of RETIRED_QUERY_PATTERNS) {
        if (pattern.test(contents)) violations.push(`${file}: ${pattern}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
