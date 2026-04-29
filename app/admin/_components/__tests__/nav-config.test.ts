import { describe, it, expect } from "vitest";
import { isNavItemActive, findNavLabel } from "../nav-config";

describe("isNavItemActive", () => {
  it("treats /admin as active only on exact /admin (not on /admin/users)", () => {
    expect(isNavItemActive("/admin", "/admin")).toBe(true);
    expect(isNavItemActive("/admin", "/admin/users")).toBe(false);
  });

  it("regression: /admin/audit must NOT match /admin/audit-archive", () => {
    expect(isNavItemActive("/admin/audit", "/admin/audit-archive")).toBe(false);
  });

  it("matches the same path or strict descendants", () => {
    expect(isNavItemActive("/admin/audit", "/admin/audit")).toBe(true);
    expect(isNavItemActive("/admin/audit", "/admin/audit/foo")).toBe(true);
  });

  it("does not match siblings via prefix", () => {
    expect(isNavItemActive("/admin/users", "/admin/users-archive")).toBe(false);
  });
});

describe("findNavLabel", () => {
  it("returns the configured label for known paths", () => {
    expect(findNavLabel("/admin")).toBe("Dashboard");
    expect(findNavLabel("/admin/audit")).toBe("Audit log");
  });

  it("falls back to 'Page' for unknown paths", () => {
    expect(findNavLabel("/admin/never-defined")).toBe("Page");
  });
});
