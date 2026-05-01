// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} />
  ),
}));

import HeroThumbnailGrid from "../hero-thumbnail-grid";

afterEach(() => cleanup());

const SAMPLES = [
  { id: "a1", title: "Alpha One", channel: "Ch", durationSec: 100 },
  { id: "a2", title: "Alpha Two", channel: "Ch", durationSec: 100 },
  { id: "a3", title: "Alpha Three", channel: "Ch", durationSec: 100 },
  { id: "a4", title: "Alpha Four", channel: "Ch", durationSec: 100 },
  { id: "a5", title: "Alpha Five", channel: "Ch", durationSec: 100 },
  { id: "a6", title: "Alpha Six", channel: "Ch", durationSec: 100 },
] as const;

describe("HeroThumbnailGrid", () => {
  it("renders one toggle button per sample", () => {
    render(
      <HeroThumbnailGrid
        samples={SAMPLES}
        activeId="a1"
        onSelect={() => {}}
      />,
    );
    expect(screen.getAllByRole("button").length).toBe(6);
  });

  it("marks the active sample with aria-pressed=true and others false", () => {
    render(
      <HeroThumbnailGrid
        samples={SAMPLES}
        activeId="a3"
        onSelect={() => {}}
      />,
    );
    const active = screen.getByRole("button", { name: /Alpha Three/i });
    const other = screen.getByRole("button", { name: /Alpha One/i });
    expect(active.getAttribute("aria-pressed")).toBe("true");
    expect(other.getAttribute("aria-pressed")).toBe("false");
  });

  it("fires onSelect with the clicked sample's id", () => {
    const onSelect = vi.fn();
    render(
      <HeroThumbnailGrid samples={SAMPLES} activeId="a1" onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Alpha Four/i }));
    expect(onSelect).toHaveBeenCalledWith("a4");
  });
});
