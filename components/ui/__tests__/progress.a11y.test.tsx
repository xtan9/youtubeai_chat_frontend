// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import { Progress } from "@/components/ui/progress";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Progress a11y", () => {
  it("determinate progress with aria-label has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Progress value={50} aria-label="Upload progress" />
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("progress at 0% has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Progress value={0} aria-label="Upload progress" />
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("progress at 100% has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Progress value={100} aria-label="Upload progress" />
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("indeterminate progress (value=null) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Progress value={null} aria-label="Loading" />
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("progress paired with a visible label via aria-labelledby has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <p id="upload-label">Uploading file…</p>
        <Progress value={64} aria-labelledby="upload-label" />
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
