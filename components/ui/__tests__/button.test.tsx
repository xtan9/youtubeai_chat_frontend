// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { createRef } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Button", () => {
  describe("rendering", () => {
    it("renders a native button by default with data-slot", () => {
      renderWithProviders(<Button>Click me</Button>);
      const button = screen.getByRole("button", { name: "Click me" });
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("data-slot")).toBe("button");
    });

    it("merges custom className with variant classes", () => {
      renderWithProviders(<Button className="custom-class">Hi</Button>);
      const button = screen.getByRole("button");
      expect(button.className).toContain("custom-class");
      // baseline classes from CVA still present
      expect(button.className).toContain("inline-flex");
    });

    it("forwards arbitrary native props (aria-label, type, name)", () => {
      renderWithProviders(
        <Button type="submit" name="submit-btn" aria-label="Submit form">
          Go
        </Button>,
      );
      const button = screen.getByRole("button", { name: "Submit form" });
      expect(button.getAttribute("type")).toBe("submit");
      expect(button.getAttribute("name")).toBe("submit-btn");
    });
  });

  describe("variants", () => {
    // Each variant has a signature class that must survive tailwind-merge
    // (the variant-specific bg/text/border, not classes shared with the base).
    const variantSignatures: Record<
      "default" | "destructive" | "outline" | "secondary" | "ghost" | "link",
      string
    > = {
      default: "bg-surface-inverse",
      destructive: "bg-accent-danger",
      outline: "bg-surface-base",
      secondary: "bg-surface-sunken",
      ghost: "hover:bg-state-hover",
      link: "underline-offset-4",
    };

    it.each(Object.entries(variantSignatures))(
      "renders %s variant with its signature class",
      (variant, signature) => {
        renderWithProviders(
          <Button variant={variant as keyof typeof variantSignatures}>v</Button>,
        );
        expect(screen.getByRole("button").className).toContain(signature);
      },
    );

    const sizeSignatures: Record<"default" | "sm" | "lg" | "icon", string> = {
      default: "h-9",
      sm: "h-8",
      lg: "h-10",
      icon: "size-9",
    };

    it.each(Object.entries(sizeSignatures))(
      "renders %s size with its signature class",
      (size, signature) => {
        renderWithProviders(
          <Button size={size as keyof typeof sizeSignatures}>v</Button>,
        );
        expect(screen.getByRole("button").className).toContain(signature);
      },
    );

    it("buttonVariants() exports a callable variant builder", () => {
      const out = buttonVariants({ variant: "default", size: "default" });
      expect(typeof out).toBe("string");
      expect(out).toContain("inline-flex");
    });
  });

  describe("asChild composition", () => {
    it("renders the child element when asChild is true (Slot pattern)", () => {
      renderWithProviders(
        <Button asChild>
          <a href="/somewhere">Anchor</a>
        </Button>,
      );
      const link = screen.getByRole("link", { name: "Anchor" });
      expect(link.tagName).toBe("A");
      expect(link.getAttribute("href")).toBe("/somewhere");
      expect(link.getAttribute("data-slot")).toBe("button");
      // it must carry the variant classes onto the anchor
      expect(link.className).toContain("inline-flex");
    });
  });

  describe("ref forwarding (React 19 ref-as-prop)", () => {
    it("forwards a ref to the underlying button element", () => {
      const ref = createRef<HTMLButtonElement>();
      renderWithProviders(<Button ref={ref}>Refed</Button>);
      expect(ref.current).toBeInstanceOf(HTMLButtonElement);
      expect(ref.current?.textContent).toBe("Refed");
    });
  });

  describe("interactive behavior", () => {
    it("fires onClick when clicked", () => {
      const handleClick = vi.fn();
      renderWithProviders(<Button onClick={handleClick}>Press</Button>);
      fireEvent.click(screen.getByRole("button"));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it("does not fire onClick when disabled", () => {
      const handleClick = vi.fn();
      renderWithProviders(
        <Button onClick={handleClick} disabled>
          Press
        </Button>,
      );
      const button = screen.getByRole("button") as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(handleClick).not.toHaveBeenCalled();
    });

    it("is focusable and remains the active element while focused", () => {
      // Native <button> Enter/Space → click translation is browser behavior,
      // not React/JSDOM behavior — we test the platform-agnostic side here:
      // the button enters the tab order, can receive focus, and click still
      // fires while focused. Keyboard activation is exercised end-to-end via
      // Playwright smoke tests.
      const handleClick = vi.fn();
      renderWithProviders(<Button onClick={handleClick}>Press</Button>);
      const button = screen.getByRole("button");
      button.focus();
      expect(document.activeElement).toBe(button);
      fireEvent.click(button);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe("aria-invalid styling hook", () => {
    it("retains the aria-invalid attribute when set by the consumer", () => {
      renderWithProviders(<Button aria-invalid>Bad</Button>);
      const button = screen.getByRole("button");
      expect(button.getAttribute("aria-invalid")).toBe("true");
    });
  });

  describe("cursor affordance", () => {
    // Tailwind v4 preflight resets <button> to cursor: default. Every
    // governed Button must restore the hand cursor so consumers don't
    // have to remember — this is the system's contract.
    it("renders with cursor-pointer in the base classes", () => {
      renderWithProviders(<Button>Click</Button>);
      expect(screen.getByRole("button").className).toContain("cursor-pointer");
    });

    it("propagates cursor-pointer onto asChild-rendered elements", () => {
      renderWithProviders(
        <Button asChild>
          <a href="/x">Link</a>
        </Button>,
      );
      expect(screen.getByRole("link").className).toContain("cursor-pointer");
    });
  });
});
