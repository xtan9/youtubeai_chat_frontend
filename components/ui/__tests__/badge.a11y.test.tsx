// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import { Badge } from "@/components/ui/badge";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Badge a11y", () => {
  it.each(["default", "secondary", "destructive", "outline"] as const)(
    "variant=%s renders with no axe violations",
    async (variant) => {
      const { container } = renderWithProviders(
        <main>
          <Badge variant={variant}>{variant}</Badge>
        </main>,
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    },
  );

  it("badge wrapping a link (asChild) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Badge asChild>
          <a href="/inbox">3 new</a>
        </Badge>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("status badge with aria-label has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Badge role="status" aria-label="2 unread messages">
          2
        </Badge>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
