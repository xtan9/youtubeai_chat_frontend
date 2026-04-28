// @vitest-environment happy-dom
// app/(design-system)/__tests__/showcase-smoke.test.tsx
import { describe, it, expect } from "vitest";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("design system showcase routes", () => {
  it("landing page renders without console errors", async () => {
    const { default: Page } = await import("../design-system/page");
    const consoleErrors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args);
    };
    try {
      const { getByRole } = renderWithProviders(<Page />);
      const heading = getByRole("heading", {
        level: 1,
        name: /design system/i,
      });
      expect(heading).toBeTruthy();
    } finally {
      console.error = original;
    }
    expect(consoleErrors).toEqual([]);
  });

  it("tokens page renders without console errors", async () => {
    const { default: Page } = await import("../design-system/tokens/page");
    const consoleErrors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args);
    };
    try {
      const { getByRole } = renderWithProviders(<Page />);
      const heading = getByRole("heading", { level: 1, name: /tokens/i });
      expect(heading).toBeTruthy();
    } finally {
      console.error = original;
    }
    expect(consoleErrors).toEqual([]);
  });

  it("forms cluster renders Button section", async () => {
    const { default: Page } = await import("../design-system/forms/page");
    const { getByRole } = renderWithProviders(<Page />);
    expect(getByRole("heading", { level: 2, name: "Button" })).toBeTruthy();
  });

  it("containers cluster renders Card section", async () => {
    const { default: Page } = await import("../design-system/containers/page");
    const { getByRole } = renderWithProviders(<Page />);
    expect(getByRole("heading", { level: 2, name: "Card" })).toBeTruthy();
  });

  it("navigation cluster renders Tabs section", async () => {
    const { default: Page } = await import("../design-system/navigation/page");
    const { getByRole } = renderWithProviders(<Page />);
    expect(getByRole("heading", { level: 2, name: "Tabs" })).toBeTruthy();
  });

  it("data-display cluster renders Avatar section", async () => {
    const { default: Page } = await import(
      "../design-system/data-display/page"
    );
    const { getByRole } = renderWithProviders(<Page />);
    expect(getByRole("heading", { level: 2, name: "Avatar" })).toBeTruthy();
  });

  it("composites cluster renders Carousel section", async () => {
    const { default: Page } = await import("../design-system/composites/page");
    const { getByRole } = renderWithProviders(<Page />);
    expect(getByRole("heading", { level: 2, name: "Carousel" })).toBeTruthy();
  });
});
