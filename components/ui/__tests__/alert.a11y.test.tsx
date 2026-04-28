// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Alert a11y", () => {
  it("default alert with title + description has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Alert>
          <AlertTitle>Heads up!</AlertTitle>
          <AlertDescription>
            You can add components to your app using the cli.
          </AlertDescription>
        </Alert>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("destructive alert with title + description has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            Your session has expired. Please log in again.
          </AlertDescription>
        </Alert>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("alert with title only (no description) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Alert>
          <AlertTitle>Saved</AlertTitle>
        </Alert>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("polite (non-urgent) alert has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Alert aria-live="polite">
          <AlertTitle>Update available</AlertTitle>
          <AlertDescription>
            A new version of the app is ready to install.
          </AlertDescription>
        </Alert>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
