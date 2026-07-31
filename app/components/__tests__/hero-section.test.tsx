// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HeroSection } from "../hero-section";

afterEach(cleanup);

describe("HeroSection", () => {
  it("keeps decorative layers from intercepting controls below the hero", () => {
    const { container } = render(<HeroSection />);
    const decorations = container.querySelectorAll(
      ".animate-pulse, .animate-float, .animate-float-delay, .animate-float-slow",
    );

    expect(decorations).toHaveLength(4);
    for (const decoration of decorations) {
      expect(decoration.classList.contains("pointer-events-none")).toBe(true);
    }
  });
});
