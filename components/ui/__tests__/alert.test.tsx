// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Alert", () => {
  describe("default render", () => {
    it("renders a div with role=alert and data-slot=alert", () => {
      renderWithProviders(
        <Alert data-testid="a">
          <AlertTitle>Heads up</AlertTitle>
          <AlertDescription>Something happened.</AlertDescription>
        </Alert>,
      );
      const alert = screen.getByTestId("a");
      expect(alert.tagName).toBe("DIV");
      expect(alert.getAttribute("role")).toBe("alert");
      expect(alert.getAttribute("data-slot")).toBe("alert");
      expect(alert.className).toContain("bg-card");
    });

    it("emits data-slot on title and description", () => {
      renderWithProviders(
        <Alert>
          <AlertTitle data-testid="t">Title</AlertTitle>
          <AlertDescription data-testid="d">Description</AlertDescription>
        </Alert>,
      );
      expect(screen.getByTestId("t").getAttribute("data-slot")).toBe(
        "alert-title",
      );
      expect(screen.getByTestId("d").getAttribute("data-slot")).toBe(
        "alert-description",
      );
    });
  });

  describe("variants", () => {
    it("variant=default applies bg-card", () => {
      renderWithProviders(<Alert data-testid="a">x</Alert>);
      expect(screen.getByTestId("a").className).toContain("bg-card");
      expect(screen.getByTestId("a").className).toContain("text-card-foreground");
    });

    it("variant=destructive applies destructive text color", () => {
      renderWithProviders(
        <Alert variant="destructive" data-testid="a">
          x
        </Alert>,
      );
      const alert = screen.getByTestId("a");
      expect(alert.className).toContain("text-destructive");
      expect(alert.className).toContain("bg-card");
    });
  });

  describe("native prop forwarding", () => {
    it("merges consumer className onto root", () => {
      renderWithProviders(
        <Alert className="my-alert" data-testid="a">
          x
        </Alert>,
      );
      expect(screen.getByTestId("a").className).toContain("my-alert");
    });

    it("forwards arbitrary native attributes (id, aria-live)", () => {
      // role=alert auto-implies aria-live=assertive; consumers can override
      // to aria-live=polite for non-urgent updates.
      renderWithProviders(
        <Alert id="al1" aria-live="polite">
          <AlertTitle>Saved</AlertTitle>
        </Alert>,
      );
      const alert = document.getElementById("al1");
      expect(alert).toBeTruthy();
      expect(alert?.getAttribute("aria-live")).toBe("polite");
    });
  });
});
