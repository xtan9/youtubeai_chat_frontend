// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { Badge } from "@/components/ui/badge";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Badge", () => {
  describe("default render", () => {
    it("renders a span with data-slot=badge and the default variant classes", () => {
      renderWithProviders(<Badge data-testid="b">New</Badge>);
      const badge = screen.getByTestId("b");
      expect(badge.tagName).toBe("SPAN");
      expect(badge.getAttribute("data-slot")).toBe("badge");
      expect(badge.className).toContain("bg-primary");
      expect(badge.className).toContain("text-primary-foreground");
      expect(badge.textContent).toBe("New");
    });
  });

  describe("variants", () => {
    it.each([
      ["default", "bg-primary"],
      ["secondary", "bg-secondary"],
      ["destructive", "bg-destructive"],
      ["outline", "text-foreground"],
    ] as const)("variant=%s applies %s class", (variant, expectedClass) => {
      renderWithProviders(
        <Badge variant={variant} data-testid="b">
          {variant}
        </Badge>,
      );
      expect(screen.getByTestId("b").className).toContain(expectedClass);
    });
  });

  describe("asChild", () => {
    // Badge supports `asChild` so consumers can wrap an <a> while keeping
    // the badge styling (the [a&] selectors in the variants apply hover).
    it("renders the child element instead of the default span when asChild", () => {
      renderWithProviders(
        <Badge asChild data-testid="b">
          <a href="/somewhere">link-badge</a>
        </Badge>,
      );
      const badge = screen.getByTestId("b");
      expect(badge.tagName).toBe("A");
      expect(badge.getAttribute("href")).toBe("/somewhere");
      expect(badge.getAttribute("data-slot")).toBe("badge");
      expect(badge.className).toContain("bg-primary");
    });
  });

  describe("native prop forwarding", () => {
    it("merges consumer className onto variant classes", () => {
      renderWithProviders(
        <Badge className="my-extra" data-testid="b">
          x
        </Badge>,
      );
      const badge = screen.getByTestId("b");
      expect(badge.className).toContain("my-extra");
      expect(badge.className).toContain("bg-primary");
    });

    it("forwards arbitrary native attributes (id, role, aria-label)", () => {
      renderWithProviders(
        <Badge id="b1" role="status" aria-label="2 unread">
          2
        </Badge>,
      );
      const badge = document.getElementById("b1");
      expect(badge).toBeTruthy();
      expect(badge?.getAttribute("role")).toBe("status");
      expect(badge?.getAttribute("aria-label")).toBe("2 unread");
    });
  });
});
