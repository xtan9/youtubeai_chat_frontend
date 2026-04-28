// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Carousel a11y", () => {
  it("default carousel with prev/next nav has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Carousel className="w-64">
          <CarouselContent>
            <CarouselItem>Slide 1</CarouselItem>
            <CarouselItem>Slide 2</CarouselItem>
            <CarouselItem>Slide 3</CarouselItem>
          </CarouselContent>
          <CarouselPrevious />
          <CarouselNext />
        </Carousel>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("vertical-orientation carousel has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Carousel orientation="vertical" className="h-64">
          <CarouselContent>
            <CarouselItem>Slide 1</CarouselItem>
            <CarouselItem>Slide 2</CarouselItem>
          </CarouselContent>
          <CarouselPrevious />
          <CarouselNext />
        </Carousel>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("carousel without nav buttons has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Carousel className="w-64">
          <CarouselContent>
            <CarouselItem>Slide 1</CarouselItem>
            <CarouselItem>Slide 2</CarouselItem>
          </CarouselContent>
        </Carousel>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("single-slide carousel has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Carousel className="w-64">
          <CarouselContent>
            <CarouselItem>Single slide</CarouselItem>
          </CarouselContent>
          <CarouselPrevious />
          <CarouselNext />
        </Carousel>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
