// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

// All a11y tests pair the input with a label — bare inputs trigger the
// label-required axe rule (and rightly so; the consumer must wire one up).
describe("Input a11y", () => {
  it("paired with a Label has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" />
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it.each(["text", "email", "password", "search", "tel", "url"] as const)(
    "type=%s with a Label has no axe violations",
    async (type) => {
      const { container } = renderWithProviders(
        <div>
          <Label htmlFor="f">Field</Label>
          <Input id="f" type={type} />
        </div>,
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    },
  );

  it("disabled input has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div>
        <Label htmlFor="d">Disabled</Label>
        <Input id="d" disabled />
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("aria-invalid input with describedby has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div>
        <Label htmlFor="bad">Email</Label>
        <Input id="bad" type="email" aria-invalid aria-describedby="bad-err" />
        <p id="bad-err">Enter a valid email.</p>
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("required input has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div>
        <Label htmlFor="req">Name</Label>
        <Input id="req" required />
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("aria-label is an acceptable alternative to a visible Label", async () => {
    const { container } = renderWithProviders(
      <Input aria-label="Search the docs" type="search" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
