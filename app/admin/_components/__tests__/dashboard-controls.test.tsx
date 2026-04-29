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
  it("shows 'real users' label when includeAdmins is false", () => {
    render(<DashboardControls windowDays={30} includeAdmins={false} />);
    expect(screen.getByRole("button", { name: /real users/i })).toBeTruthy();
  });

  it("shows 'incl. admins' label when includeAdmins is true", () => {
    render(<DashboardControls windowDays={30} includeAdmins={true} />);
    expect(screen.getByRole("button", { name: /incl\. admins/i })).toBeTruthy();
  });

  it("clicking the toggle adds ?include_admins=1 when off", async () => {
    const user = userEvent.setup();
    render(<DashboardControls windowDays={30} includeAdmins={false} />);
    await user.click(screen.getByRole("button", { name: /real users/i }));
    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining("include_admins=1"),
    );
  });

  it("clicking the toggle removes include_admins when already on", async () => {
    currentSearch = "include_admins=1";
    const user = userEvent.setup();
    render(<DashboardControls windowDays={30} includeAdmins={true} />);
    await user.click(screen.getByRole("button", { name: /incl\. admins/i }));
    const lastCall = replace.mock.calls.at(-1)?.[0] ?? "";
    expect(lastCall).not.toContain("include_admins");
  });
});
