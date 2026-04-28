// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@/components/ui/avatar";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Avatar", () => {
  describe("default render", () => {
    it("renders the root with data-slot=avatar and round-clip styling", () => {
      renderWithProviders(
        <Avatar data-testid="a">
          <AvatarFallback>U</AvatarFallback>
        </Avatar>,
      );
      const avatar = screen.getByTestId("a");
      expect(avatar.getAttribute("data-slot")).toBe("avatar");
      expect(avatar.className).toContain("rounded-full");
      expect(avatar.className).toContain("size-8");
    });

    it("emits data-slot on the fallback when image cannot load", () => {
      // happy-dom never fires `load` on <img>, so Radix's image stays in
      // status='loading' and the Fallback renders. This is the same path
      // that runs in production when an image 404s.
      renderWithProviders(
        <Avatar>
          <AvatarImage src="/missing.jpg" alt="Missing" />
          <AvatarFallback data-testid="fb">JD</AvatarFallback>
        </Avatar>,
      );
      const fb = screen.getByTestId("fb");
      expect(fb.getAttribute("data-slot")).toBe("avatar-fallback");
      expect(fb.textContent).toBe("JD");
    });
  });

  describe("AvatarImage", () => {
    it("does NOT render the <img> until status=loaded — Radix gates rendering on the load event", () => {
      // happy-dom doesn't fire `load`, so the <img> stays unmounted while
      // Radix waits. This documents the known happy-dom limitation; the
      // image path is exercised in Playwright smoke tests.
      const { container } = renderWithProviders(
        <Avatar>
          <AvatarImage src="/u.jpg" alt="User" data-testid="img" />
          <AvatarFallback>U</AvatarFallback>
        </Avatar>,
      );
      expect(container.querySelector("img")).toBeNull();
    });
  });

  describe("AvatarFallback delayMs", () => {
    it("renders fallback immediately when delayMs is not set", () => {
      renderWithProviders(
        <Avatar>
          <AvatarFallback>U</AvatarFallback>
        </Avatar>,
      );
      expect(screen.getByText("U")).toBeTruthy();
    });
  });

  describe("native prop forwarding", () => {
    it("merges className on each part", () => {
      renderWithProviders(
        <Avatar className="custom-root" data-testid="a">
          <AvatarFallback className="custom-fb" data-testid="fb">
            U
          </AvatarFallback>
        </Avatar>,
      );
      expect(screen.getByTestId("a").className).toContain("custom-root");
      expect(screen.getByTestId("a").className).toContain("rounded-full");
      expect(screen.getByTestId("fb").className).toContain("custom-fb");
      expect(screen.getByTestId("fb").className).toContain("bg-muted");
    });
  });
});
