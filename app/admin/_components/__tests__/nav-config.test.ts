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

import { buildAdminNav } from "../nav-config";

describe("buildAdminNav", () => {
  it("renders the Users badge with thousands-separated count when usersTotal is given", () => {
    const nav = buildAdminNav({ usersTotal: 1234 });
    const users = nav
      .flatMap((s) => s.items)
      .find((i) => i.href === "/admin/users");
    expect(users?.badge).toBe("1,234");
  });

  it("omits the Users badge when usersTotal is null", () => {
    const nav = buildAdminNav({ usersTotal: null });
    const users = nav
      .flatMap((s) => s.items)
      .find((i) => i.href === "/admin/users");
    expect(users?.badge).toBeUndefined();
  });

  it("preserves all other sections and items unchanged", () => {
    const nav = buildAdminNav({ usersTotal: 0 });
    const sectionLabels = nav.map((s) => s.label);
    expect(sectionLabels).toEqual(["Overview", "People", "Operations", "Content", "System"]);
  });
});
