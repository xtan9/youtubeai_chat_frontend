// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Textarea a11y", () => {
  it("paired with a Label has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div>
        <Label htmlFor="bio">Bio</Label>
        <Textarea id="bio" />
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("disabled textarea has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div>
        <Label htmlFor="d">Locked</Label>
        <Textarea id="d" disabled defaultValue="cannot edit" />
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("aria-invalid with describedby has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div>
        <Label htmlFor="bad">Description</Label>
        <Textarea id="bad" aria-invalid aria-describedby="bad-err" />
        <p id="bad-err">Description must be at least 10 characters.</p>
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("required textarea has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div>
        <Label htmlFor="req">Comments</Label>
        <Textarea id="req" required />
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("aria-label is an acceptable alternative to a visible Label", async () => {
    const { container } = renderWithProviders(
      <Textarea aria-label="Quick note" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("with maxLength + describedby hint has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div>
        <Label htmlFor="t">Tweet</Label>
        <Textarea
          id="t"
          maxLength={280}
          aria-describedby="t-hint"
        />
        <p id="t-hint">Up to 280 characters.</p>
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
