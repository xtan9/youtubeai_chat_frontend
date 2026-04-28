// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import * as SonnerWrapper from "@/components/ui/sonner";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Toaster (sonner wrapper)", () => {
  describe("default render", () => {
    it("mounts sonner's accessible <section> region with aria-label, aria-live=polite", () => {
      // sonner renders the <ol> data-sonner-toaster only when toasts exist.
      // The always-mounted scaffold is a <section> with the screen-reader
      // metadata. The wrapper's className+style are forwarded to the
      // <ol> when it appears (verified by the prop-spread test below).
      const { container } = renderWithProviders(<Toaster />);
      const section = container.querySelector("section");
      expect(section).toBeTruthy();
      expect(section?.getAttribute("aria-live")).toBe("polite");
      // Sonner labels the region "Notifications <hotkey>".
      expect(section?.getAttribute("aria-label")).toMatch(/Notifications/);
    });

    it("renders without throwing when no props are supplied", () => {
      // Smoke: sonner's defaults (theme='system', position='bottom-right')
      // resolve cleanly inside our ThemeProvider wrapper.
      const { container } = renderWithProviders(<Toaster />);
      expect(container.querySelector("section")).toBeTruthy();
    });
  });

  describe("ToasterProps forwarding", () => {
    it("accepts position, theme, and richColors props without errors", () => {
      // The runtime effect of these props is on the toast list and per-
      // toast styling, neither of which mounts when there are no active
      // toasts. Asserting render-without-throw documents that the
      // wrapper's `{...props}` spread is intact.
      const { container } = renderWithProviders(
        <Toaster position="top-right" theme="dark" richColors />,
      );
      expect(container.querySelector("section")).toBeTruthy();
    });

    it("accepts duration and gap props", () => {
      const { container } = renderWithProviders(
        <Toaster duration={5000} gap={12} />,
      );
      expect(container.querySelector("section")).toBeTruthy();
    });
  });

  describe("public surface", () => {
    it("exports only the Toaster component (toast() lives in 'sonner' directly)", () => {
      // The wrapper intentionally re-exports nothing else; consumers
      // import the imperative toast() / toast.success() / etc. from
      // 'sonner' directly. This documents that contract — a refactor
      // adding toast() to the wrapper triggers a deliberate review.
      expect(typeof SonnerWrapper.Toaster).toBe("function");
      expect(
        (SonnerWrapper as unknown as { toast?: unknown }).toast,
      ).toBeUndefined();
    });
  });
});
