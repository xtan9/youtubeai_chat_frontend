// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Card a11y", () => {
  it("minimal Card with content has no axe violations", async () => {
    const { container } = renderWithProviders(
      <Card>
        <CardContent>
          <p>Plain content body.</p>
        </CardContent>
      </Card>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("full composition (header + action + footer) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
            <CardDescription>Free plan</CardDescription>
            <CardAction>
              <button type="button" aria-label="Open menu">
                ...
              </button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <p>30 summaries / month.</p>
          </CardContent>
          <CardFooter>
            <button type="button">Upgrade</button>
          </CardFooter>
        </Card>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("Card promoted to a labeled region has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Card role="region" aria-labelledby="card-heading">
          <CardHeader>
            <h2 id="card-heading" className="text-lg font-semibold">
              Settings
            </h2>
          </CardHeader>
          <CardContent>
            <p>Manage your account.</p>
          </CardContent>
        </Card>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
