// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Card", () => {
  describe("slot rendering", () => {
    it("renders the root with data-slot=card and a div element", () => {
      renderWithProviders(<Card data-testid="root">body</Card>);
      const root = screen.getByTestId("root");
      expect(root.tagName).toBe("DIV");
      expect(root.getAttribute("data-slot")).toBe("card");
      expect(root.textContent).toBe("body");
    });

    it.each([
      [CardHeader, "card-header"],
      [CardTitle, "card-title"],
      [CardDescription, "card-description"],
      [CardAction, "card-action"],
      [CardContent, "card-content"],
      [CardFooter, "card-footer"],
    ] as const)("emits the data-slot attribute on %s", (Component, slot) => {
      renderWithProviders(<Component data-testid={slot} />);
      expect(screen.getByTestId(slot).getAttribute("data-slot")).toBe(slot);
    });
  });

  describe("classNames", () => {
    it("applies baseline surface classes (bg-surface-raised, rounded-xl, shadow-sm) on root", () => {
      renderWithProviders(<Card data-testid="root" />);
      const cls = screen.getByTestId("root").className;
      expect(cls).toContain("bg-surface-raised");
      expect(cls).toContain("text-text-primary");
      expect(cls).toContain("rounded-xl");
      expect(cls).toContain("shadow-sm");
      expect(cls).toContain("border");
    });

    it("merges consumer className with baseline classes via cn()", () => {
      renderWithProviders(<Card className="my-card" data-testid="root" />);
      const cls = screen.getByTestId("root").className;
      expect(cls).toContain("my-card");
      // baseline survives merge
      expect(cls).toContain("rounded-xl");
    });

    it("CardContent applies horizontal padding", () => {
      renderWithProviders(<CardContent data-testid="content" />);
      expect(screen.getByTestId("content").className).toContain("px-6");
    });

    it("CardTitle uses semibold + tight leading", () => {
      renderWithProviders(<CardTitle data-testid="title" />);
      const cls = screen.getByTestId("title").className;
      expect(cls).toContain("font-semibold");
      expect(cls).toContain("leading-none");
    });

    it("CardDescription uses muted foreground + small text", () => {
      renderWithProviders(<CardDescription data-testid="desc" />);
      const cls = screen.getByTestId("desc").className;
      expect(cls).toContain("text-text-muted");
      expect(cls).toContain("text-sm");
    });
  });

  describe("composition", () => {
    it("renders the canonical Card composition with all slots in DOM order", () => {
      renderWithProviders(
        <Card>
          <CardHeader>
            <CardTitle>Title</CardTitle>
            <CardDescription>Description</CardDescription>
            <CardAction>
              <button type="button">act</button>
            </CardAction>
          </CardHeader>
          <CardContent>Body</CardContent>
          <CardFooter>Footer</CardFooter>
        </Card>,
      );
      expect(screen.getByText("Title").getAttribute("data-slot")).toBe(
        "card-title",
      );
      expect(screen.getByText("Description").getAttribute("data-slot")).toBe(
        "card-description",
      );
      expect(screen.getByText("Body").getAttribute("data-slot")).toBe(
        "card-content",
      );
      expect(screen.getByText("Footer").getAttribute("data-slot")).toBe(
        "card-footer",
      );
      expect(screen.getByRole("button", { name: "act" })).toBeTruthy();
    });
  });

  describe("native prop forwarding", () => {
    it("forwards arbitrary native attributes (id, aria-label, role)", () => {
      renderWithProviders(
        <Card id="card-1" role="region" aria-label="Summary" />,
      );
      const node = document.getElementById("card-1");
      expect(node).toBeTruthy();
      expect(node?.getAttribute("role")).toBe("region");
      expect(node?.getAttribute("aria-label")).toBe("Summary");
    });
  });
});
