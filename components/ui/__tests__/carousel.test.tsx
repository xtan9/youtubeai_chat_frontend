// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

// embla-carousel measures real layout to decide canScrollPrev/Next.
// happy-dom returns 0 for layout, so canScroll* stays false in tests.
// We exercise the static structure (slots, ARIA, key handling) and
// rely on Playwright smoke tests for live scroll behaviour.

describe("Carousel", () => {
  describe("default render", () => {
    it("renders the root with role=region and aria-roledescription=carousel", () => {
      renderWithProviders(
        <Carousel data-testid="root">
          <CarouselContent>
            <CarouselItem>One</CarouselItem>
            <CarouselItem>Two</CarouselItem>
          </CarouselContent>
        </Carousel>,
      );
      const root = screen.getByTestId("root");
      expect(root.getAttribute("role")).toBe("region");
      expect(root.getAttribute("aria-roledescription")).toBe("carousel");
      expect(root.getAttribute("data-slot")).toBe("carousel");
    });

    it("renders CarouselContent with data-slot and CarouselItem with role=group + aria-roledescription=slide", () => {
      const { container } = renderWithProviders(
        <Carousel>
          <CarouselContent>
            <CarouselItem data-testid="item">One</CarouselItem>
          </CarouselContent>
        </Carousel>,
      );
      // CarouselContent renders an outer overflow wrapper carrying
      // data-slot=carousel-content; the consumer's props end up on
      // the inner sliding `flex` element.
      expect(
        container.querySelector('[data-slot="carousel-content"]'),
      ).toBeTruthy();
      const item = screen.getByTestId("item");
      expect(item.getAttribute("data-slot")).toBe("carousel-item");
      expect(item.getAttribute("role")).toBe("group");
      expect(item.getAttribute("aria-roledescription")).toBe("slide");
    });
  });

  describe("orientation", () => {
    it("default orientation is horizontal — content uses -ml-4 spacing", () => {
      const { container } = renderWithProviders(
        <Carousel>
          <CarouselContent>
            <CarouselItem>One</CarouselItem>
          </CarouselContent>
        </Carousel>,
      );
      // The horizontal pattern uses negative left margin on the
      // sliding container; vertical uses negative top + flex-col.
      const inner = container
        .querySelector('[data-slot="carousel-content"]')
        ?.querySelector(".flex");
      expect(inner?.className).toContain("-ml-4");
    });

    it("vertical orientation toggles the content to flex-col + -mt-4", () => {
      const { container } = renderWithProviders(
        <Carousel orientation="vertical">
          <CarouselContent>
            <CarouselItem>One</CarouselItem>
          </CarouselContent>
        </Carousel>,
      );
      const inner = container
        .querySelector('[data-slot="carousel-content"]')
        ?.querySelector(".flex");
      expect(inner?.className).toContain("flex-col");
      expect(inner?.className).toContain("-mt-4");
    });
  });

  describe("nav buttons", () => {
    it("CarouselPrevious renders a button with data-slot=carousel-previous and an sr-only label", () => {
      renderWithProviders(
        <Carousel>
          <CarouselContent>
            <CarouselItem>One</CarouselItem>
          </CarouselContent>
          <CarouselPrevious data-testid="prev" />
          <CarouselNext data-testid="next" />
        </Carousel>,
      );
      const prev = screen.getByTestId("prev");
      const next = screen.getByTestId("next");
      expect(prev.getAttribute("data-slot")).toBe("carousel-previous");
      expect(next.getAttribute("data-slot")).toBe("carousel-next");
      // Default size + variant supplied by the wrapper
      expect(prev.tagName).toBe("BUTTON");
      // sr-only "Previous slide" / "Next slide" labels exist for AT
      expect(screen.getByText("Previous slide")).toBeTruthy();
      expect(screen.getByText("Next slide")).toBeTruthy();
    });

    it("nav buttons start disabled when there's nothing to scroll yet (happy-dom layout returns 0)", () => {
      renderWithProviders(
        <Carousel>
          <CarouselContent>
            <CarouselItem>One</CarouselItem>
          </CarouselContent>
          <CarouselPrevious data-testid="prev" />
          <CarouselNext data-testid="next" />
        </Carousel>,
      );
      // Without measured overflow, canScrollPrev/Next stay false.
      expect(screen.getByTestId("prev").hasAttribute("disabled")).toBe(true);
      expect(screen.getByTestId("next").hasAttribute("disabled")).toBe(true);
    });
  });

  describe("keyboard navigation", () => {
    it("ArrowLeft / ArrowRight key handler is wired and dispatches without throwing", () => {
      renderWithProviders(
        <Carousel data-testid="root">
          <CarouselContent>
            <CarouselItem>One</CarouselItem>
            <CarouselItem>Two</CarouselItem>
          </CarouselContent>
        </Carousel>,
      );
      // Without real layout we can't assert that scroll happened,
      // but the handler attachment shouldn't throw on key events.
      const root = screen.getByTestId("root");
      expect(() => {
        fireEvent.keyDown(root, { key: "ArrowLeft" });
        fireEvent.keyDown(root, { key: "ArrowRight" });
      }).not.toThrow();
    });
  });

  describe("setApi callback", () => {
    it("invokes setApi with the embla API once on mount", () => {
      const calls: unknown[] = [];
      const setApi = (api: unknown) => {
        calls.push(api);
      };
      renderWithProviders(
        <Carousel setApi={setApi as unknown as (api: unknown) => void}>
          <CarouselContent>
            <CarouselItem>One</CarouselItem>
          </CarouselContent>
        </Carousel>,
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("native prop forwarding", () => {
    it("merges className on the root", () => {
      renderWithProviders(
        <Carousel className="my-carousel" data-testid="root">
          <CarouselContent>
            <CarouselItem>One</CarouselItem>
          </CarouselContent>
        </Carousel>,
      );
      expect(screen.getByTestId("root").className).toContain("my-carousel");
    });
  });
});
