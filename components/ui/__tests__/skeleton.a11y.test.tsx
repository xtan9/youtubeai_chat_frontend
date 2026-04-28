// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import { Skeleton } from "@/components/ui/skeleton";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Skeleton a11y", () => {
  it("standalone skeleton (decorative) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Skeleton className="h-6 w-40" aria-hidden="true" />
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("loading region (role=status + aria-busy) wrapping skeletons has no axe violations", async () => {
    // The canonical pattern: a single role=status wrapper with aria-busy
    // and aria-label; individual skeletons are decorative children.
    const { container } = renderWithProviders(
      <main>
        <div role="status" aria-busy="true" aria-label="Loading user list">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("skeleton with role=status directly (single-cell loader) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Skeleton
          role="status"
          aria-busy="true"
          aria-label="Loading"
          className="h-8 w-32"
        />
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
