// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Switch a11y", () => {
  it("paired with a Label has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div className="flex items-center gap-2">
        <Switch id="notifications" />
        <Label htmlFor="notifications">Email notifications</Label>
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("checked state has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div className="flex items-center gap-2">
        <Switch id="on" defaultChecked />
        <Label htmlFor="on">Enabled</Label>
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("disabled state has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div className="flex items-center gap-2">
        <Switch id="d" disabled />
        <Label htmlFor="d">Locked</Label>
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("aria-label without a visible Label has no axe violations", async () => {
    const { container } = renderWithProviders(
      <Switch aria-label="Dark mode" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("settings-row pattern has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor="auto">Auto-save</Label>
          <p className="text-sm text-muted-foreground" id="auto-desc">
            Save changes every 30 seconds.
          </p>
        </div>
        <Switch id="auto" aria-describedby="auto-desc" />
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
