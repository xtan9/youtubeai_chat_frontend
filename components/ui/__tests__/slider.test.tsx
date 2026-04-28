// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import { Slider } from "@/components/ui/slider";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Slider", () => {
  describe("default render", () => {
    it("renders root, track, range, and a single thumb with the right data-slot attributes", () => {
      renderWithProviders(<Slider data-testid="slider" />);
      const root = screen.getByTestId("slider");
      expect(root.getAttribute("data-slot")).toBe("slider");
      expect(
        root.querySelector('[data-slot="slider-track"]'),
      ).toBeTruthy();
      expect(
        root.querySelector('[data-slot="slider-range"]'),
      ).toBeTruthy();
      const thumbs = root.querySelectorAll('[data-slot="slider-thumb"]');
      // Default has no value/defaultValue, so the slider mounts a thumb at
      // each end of the [min, max] range — two thumbs.
      expect(thumbs.length).toBe(2);
    });

    it("uses min=0 and max=100 by default", () => {
      renderWithProviders(<Slider data-testid="slider" />);
      const root = screen.getByTestId("slider");
      const thumbs = root.querySelectorAll('[role="slider"]');
      // Thumb's aria-valuemin / aria-valuemax should reflect defaults
      expect(thumbs[0].getAttribute("aria-valuemin")).toBe("0");
      expect(thumbs[0].getAttribute("aria-valuemax")).toBe("100");
    });
  });

  describe("uncontrolled mode (defaultValue)", () => {
    it("renders one thumb per defaultValue entry", () => {
      renderWithProviders(
        <Slider defaultValue={[40]} data-testid="slider" />,
      );
      const thumbs = screen
        .getByTestId("slider")
        .querySelectorAll('[role="slider"]');
      expect(thumbs.length).toBe(1);
      expect(thumbs[0].getAttribute("aria-valuenow")).toBe("40");
    });

    it("renders two thumbs for a range slider", () => {
      renderWithProviders(
        <Slider defaultValue={[20, 80]} data-testid="slider" />,
      );
      const thumbs = screen
        .getByTestId("slider")
        .querySelectorAll('[role="slider"]');
      expect(thumbs.length).toBe(2);
      expect(thumbs[0].getAttribute("aria-valuenow")).toBe("20");
      expect(thumbs[1].getAttribute("aria-valuenow")).toBe("80");
    });
  });

  describe("controlled mode (value + onValueChange)", () => {
    it("emits onValueChange when the user uses arrow keys to change value", () => {
      const onValueChange = vi.fn();
      function Harness() {
        const [v, setV] = useState<number[]>([50]);
        return (
          <Slider
            value={v}
            onValueChange={(next) => {
              setV(next);
              onValueChange(next);
            }}
            data-testid="slider"
          />
        );
      }
      renderWithProviders(<Harness />);
      const thumb = screen
        .getByTestId("slider")
        .querySelector('[role="slider"]') as HTMLElement;
      fireEvent.keyDown(thumb, { key: "ArrowRight" });
      expect(onValueChange).toHaveBeenCalled();
    });
  });

  describe("min/max overrides", () => {
    it("respects custom min and max", () => {
      renderWithProviders(
        <Slider
          min={-10}
          max={10}
          defaultValue={[0]}
          data-testid="slider"
        />,
      );
      const thumb = screen
        .getByTestId("slider")
        .querySelector('[role="slider"]');
      expect(thumb?.getAttribute("aria-valuemin")).toBe("-10");
      expect(thumb?.getAttribute("aria-valuemax")).toBe("10");
      expect(thumb?.getAttribute("aria-valuenow")).toBe("0");
    });
  });

  describe("orientation", () => {
    it("vertical orientation sets data-orientation=vertical on the root and thumbs", () => {
      renderWithProviders(
        <Slider
          orientation="vertical"
          defaultValue={[50]}
          data-testid="slider"
        />,
      );
      const root = screen.getByTestId("slider");
      expect(root.getAttribute("data-orientation")).toBe("vertical");
      const thumb = root.querySelector('[role="slider"]');
      expect(thumb?.getAttribute("aria-orientation")).toBe("vertical");
    });
  });

  describe("disabled state", () => {
    it("disabled root carries data-disabled and the thumb is aria-disabled", () => {
      renderWithProviders(
        <Slider defaultValue={[50]} disabled data-testid="slider" />,
      );
      const root = screen.getByTestId("slider");
      // Radix sets data-disabled on the root + each thumb
      expect(root.hasAttribute("data-disabled")).toBe(true);
    });
  });

  describe("native prop forwarding", () => {
    it("merges className onto the root", () => {
      renderWithProviders(
        <Slider className="my-slider" data-testid="slider" />,
      );
      expect(screen.getByTestId("slider").className).toContain("my-slider");
    });
  });
});
