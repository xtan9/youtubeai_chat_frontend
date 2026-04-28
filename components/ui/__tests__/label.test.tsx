// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { createRef } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Label", () => {
  describe("rendering", () => {
    it("renders a label element with data-slot", () => {
      renderWithProviders(<Label>Email</Label>);
      const label = screen.getByText("Email");
      expect(label.tagName).toBe("LABEL");
      expect(label.getAttribute("data-slot")).toBe("label");
    });

    it("merges custom className with base classes", () => {
      renderWithProviders(<Label className="custom-label">Hi</Label>);
      const label = screen.getByText("Hi");
      expect(label.className).toContain("custom-label");
      expect(label.className).toContain("text-sm");
      expect(label.className).toContain("font-medium");
    });

    it("forwards htmlFor to the underlying label", () => {
      renderWithProviders(<Label htmlFor="email-field">Email</Label>);
      const label = screen.getByText("Email") as HTMLLabelElement;
      expect(label.htmlFor).toBe("email-field");
    });
  });

  describe("ref forwarding", () => {
    it("forwards a ref to the label element", () => {
      const ref = createRef<HTMLLabelElement>();
      renderWithProviders(<Label ref={ref}>Refed</Label>);
      expect(ref.current).toBeInstanceOf(HTMLLabelElement);
    });
  });

  describe("association with form controls", () => {
    it("htmlFor links the label to the input by accessible name", () => {
      renderWithProviders(
        <div>
          <Label htmlFor="my-input">Name</Label>
          <Input id="my-input" placeholder="n" />
        </div>,
      );
      // Testing-library resolves the label-input pairing via accessible name —
      // this proves the htmlFor/id contract is wired up correctly.
      const input = screen.getByLabelText("Name") as HTMLInputElement;
      expect(input.id).toBe("my-input");
    });

    it("wrapping the control inside the label also links them (implicit association)", () => {
      renderWithProviders(
        <Label>
          Wrapped
          <Input placeholder="w" />
        </Label>,
      );
      const input = screen.getByLabelText("Wrapped") as HTMLInputElement;
      expect(input.tagName).toBe("INPUT");
    });

    it("a click event on the label fires (delegating to the wrapped control is browser behavior)", () => {
      renderWithProviders(
        <div>
          <Label htmlFor="lbl">Click</Label>
          <Input id="lbl" placeholder="l" />
        </div>,
      );
      const label = screen.getByText("Click");
      // The click event itself dispatches; browser-level "click on label
      // focuses the linked input" is platform behavior, not under test here.
      expect(() => fireEvent.click(label)).not.toThrow();
    });
  });

  describe("disabled state inheritance via group/peer", () => {
    it("applies the group-data-[disabled=true] disabled-style hook", () => {
      // The Label uses `group-data-[disabled=true]:pointer-events-none` and
      // `peer-disabled:cursor-not-allowed` — verify those classes ship.
      renderWithProviders(<Label>Field</Label>);
      const label = screen.getByText("Field");
      expect(label.className).toContain(
        "group-data-[disabled=true]:pointer-events-none",
      );
      expect(label.className).toContain("peer-disabled:cursor-not-allowed");
    });
  });
});
