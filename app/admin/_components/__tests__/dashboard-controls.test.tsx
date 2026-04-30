// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
const refresh = vi.fn();
let currentSearch = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
  usePathname: () => "/admin",
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

import { DashboardControls } from "../dashboard-controls";

beforeEach(() => {
  replace.mockClear();
  refresh.mockClear();
  currentSearch = "";
});
afterEach(() => cleanup());

describe("DashboardControls toggle", () => {
  it("renders the include-admins switch unchecked by default", () => {
    render(<DashboardControls windowDays={30} includeAdmins={false} />);
    const sw = screen.getByRole("switch", { name: /include admins/i });
    expect(sw).toBeTruthy();
    expect(sw.getAttribute("data-state")).toBe("unchecked");
  });

  it("renders the include-admins switch checked when includeAdmins=true", () => {
    render(<DashboardControls windowDays={30} includeAdmins={true} />);
    const sw = screen.getByRole("switch", { name: /include admins/i });
    expect(sw.getAttribute("data-state")).toBe("checked");
  });

  it("clicking the switch when off adds ?include_admins=1", async () => {
    const user = userEvent.setup();
    render(<DashboardControls windowDays={30} includeAdmins={false} />);
    await user.click(screen.getByRole("switch", { name: /include admins/i }));
    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining("include_admins=1"),
    );
  });

  it("clicking the switch when on removes include_admins", async () => {
    currentSearch = "include_admins=1";
    const user = userEvent.setup();
    render(<DashboardControls windowDays={30} includeAdmins={true} />);
    await user.click(screen.getByRole("switch", { name: /include admins/i }));
    const lastCall = replace.mock.calls.at(-1)?.[0] ?? "";
    expect(lastCall).not.toContain("include_admins");
  });
});
