// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
let currentSearch = "";
let currentPath = "/admin";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => currentPath,
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

import { IncludeAdminsToggle } from "../include-admins-toggle";

beforeEach(() => {
  replace.mockClear();
  currentSearch = "";
  currentPath = "/admin";
});
afterEach(() => cleanup());

describe("IncludeAdminsToggle", () => {
  it("renders a switch labeled 'Include admins'", () => {
    render(<IncludeAdminsToggle checked={false} />);
    const sw = screen.getByRole("switch", { name: /include admins/i });
    expect(sw).toBeTruthy();
  });

  it("is unchecked when prop checked={false}", () => {
    render(<IncludeAdminsToggle checked={false} />);
    const sw = screen.getByRole("switch", { name: /include admins/i });
    expect(sw.getAttribute("data-state")).toBe("unchecked");
  });

  it("is checked when prop checked={true}", () => {
    render(<IncludeAdminsToggle checked={true} />);
    const sw = screen.getByRole("switch", { name: /include admins/i });
    expect(sw.getAttribute("data-state")).toBe("checked");
  });

  it("clicking when unchecked calls router.replace with include_admins=1", async () => {
    const user = userEvent.setup();
    render(<IncludeAdminsToggle checked={false} />);
    await user.click(screen.getByRole("switch", { name: /include admins/i }));
    expect(replace).toHaveBeenCalledTimes(1);
    const arg = replace.mock.calls[0][0] as string;
    expect(arg).toContain("include_admins=1");
  });

  it("clicking when checked calls router.replace WITHOUT include_admins", async () => {
    currentSearch = "include_admins=1";
    const user = userEvent.setup();
    render(<IncludeAdminsToggle checked={true} />);
    await user.click(screen.getByRole("switch", { name: /include admins/i }));
    expect(replace).toHaveBeenCalledTimes(1);
    const arg = replace.mock.calls[0][0] as string;
    expect(arg).not.toContain("include_admins");
  });

  it("preserves other URL params when toggling on", async () => {
    currentSearch = "window=7";
    const user = userEvent.setup();
    render(<IncludeAdminsToggle checked={false} />);
    await user.click(screen.getByRole("switch", { name: /include admins/i }));
    const arg = replace.mock.calls[0][0] as string;
    expect(arg).toContain("window=7");
    expect(arg).toContain("include_admins=1");
  });
});
