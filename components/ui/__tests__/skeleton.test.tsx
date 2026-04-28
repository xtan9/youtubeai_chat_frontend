// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { Skeleton } from "@/components/ui/skeleton";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Skeleton", () => {
  describe("default render", () => {
    it("renders a div with data-slot=skeleton and the animate-pulse + bg-state-hover classes", () => {
      renderWithProviders(<Skeleton data-testid="s" />);
      const sk = screen.getByTestId("s");
      expect(sk.tagName).toBe("DIV");
      expect(sk.getAttribute("data-slot")).toBe("skeleton");
      expect(sk.className).toContain("animate-pulse");
      expect(sk.className).toContain("bg-state-hover");
      expect(sk.className).toContain("rounded-md");
    });
  });

  describe("native prop forwarding", () => {
    it("merges consumer className onto base classes", () => {
      renderWithProviders(
        <Skeleton className="h-4 w-32" data-testid="s" />,
      );
      const sk = screen.getByTestId("s");
      expect(sk.className).toContain("h-4");
      expect(sk.className).toContain("w-32");
      expect(sk.className).toContain("animate-pulse");
    });

    it("forwards arbitrary native attributes (id, role, aria-label, aria-busy)", () => {
      // role=status + aria-busy is the canonical loading-region pattern;
      // the consumer wires it. Skeleton itself stays presentation-neutral.
      renderWithProviders(
        <Skeleton
          id="sk1"
          role="status"
          aria-busy="true"
          aria-label="Loading user data"
        />,
      );
      const sk = document.getElementById("sk1");
      expect(sk).toBeTruthy();
      expect(sk?.getAttribute("role")).toBe("status");
      expect(sk?.getAttribute("aria-busy")).toBe("true");
      expect(sk?.getAttribute("aria-label")).toBe("Loading user data");
    });
  });

  describe("composition", () => {
    it("renders multiple skeletons (e.g., a list placeholder)", () => {
      renderWithProviders(
        <div role="status" aria-label="Loading items">
          <Skeleton className="h-4 w-32" data-testid="s1" />
          <Skeleton className="h-4 w-24" data-testid="s2" />
          <Skeleton className="h-4 w-40" data-testid="s3" />
        </div>,
      );
      expect(screen.getByTestId("s1")).toBeTruthy();
      expect(screen.getByTestId("s2")).toBeTruthy();
      expect(screen.getByTestId("s3")).toBeTruthy();
    });
  });
});
