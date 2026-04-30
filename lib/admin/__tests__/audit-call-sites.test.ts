// Contract test: writeAudit must only be called from server actions that
// surface transcript or summary text — never from any /admin page that
// renders aggregate data. PR-3 acceptance criterion: "Listing pages
// (/admin/users rendering the row, /admin top-users table) do not write
// audit rows."
//
// This test does a lightweight static scan of the source tree (no AST
// — string-grep on source text is sufficient because the only legitimate
// way to call writeAudit is via an explicit `import` of `@/lib/admin/audit`).
// A future PR that introduces a new caller has to either land in this
// allowlist or move under app/admin/**/_actions/.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

function walk(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, base));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
    ) {
      out.push(path.relative(base, full));
    }
  }
  return out;
}

/** Files allowed to import or call writeAudit. Add only after deliberate
 * review: each entry is a content-revealing boundary (not a list page). */
const ALLOWED_CALLERS: readonly string[] = [
  // The action that surfaces transcript text on /admin/users → modal.
  "app/admin/users/_actions/view-transcript.ts",
  // /admin/videos drill-down server actions — each writes audit at the
  // content-revealing boundary (summary text, transcript text, or revealed
  // user list). Per spike-003, only these are audited; the page itself,
  // KPI strip, and row-expansion stats never write audit rows.
  "app/admin/videos/_actions/view-video-summary.ts",
  "app/admin/videos/_actions/view-video-transcript.ts",
  "app/admin/videos/_actions/view-video-users.ts",
  // Tests of writeAudit and of callers (test code can mock or import freely).
];

describe("writeAudit call sites", () => {
  it("is imported only by allowlisted server actions, never by /admin pages", () => {
    const adminDir = path.join(ROOT, "app/admin");
    const files = walk(adminDir, ROOT);
    const violations: { file: string; line: number; text: string }[] = [];
    for (const rel of files) {
      // Skip test files — they're allowed to mock/import freely.
      if (rel.includes("__tests__/")) continue;
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;
      if (ALLOWED_CALLERS.includes(rel)) continue;
      const content = readFileSync(path.join(ROOT, rel), "utf8");
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (
          /\bfrom\s+["']@\/lib\/admin\/audit["']/.test(line) ||
          /\bwriteAudit\s*\(/.test(line)
        ) {
          violations.push({ file: rel, line: idx + 1, text: line.trim() });
        }
      });
    }
    expect(
      violations,
      `unexpected writeAudit caller(s):\n${violations
        .map((v) => `  ${v.file}:${v.line}  ${v.text}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
