// @vitest-environment happy-dom
// Test fixtures use raw <img> tags for axe coverage of common consumer
// patterns (alt text, aria-hidden decorative). Next.js's <Image /> would
// add framework-specific concerns we don't need to test here.
/* eslint-disable @next/next/no-img-element */
import { describe, it, expect } from "vitest";

import { AspectRatio } from "@/components/ui/aspect-ratio";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("AspectRatio a11y", () => {
  it("16:9 image inside AspectRatio has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <AspectRatio ratio={16 / 9}>
          <img
            src="/thumb.jpg"
            alt="Video thumbnail"
            className="h-full w-full object-cover"
          />
        </AspectRatio>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("decorative image (alt='') inside AspectRatio has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <AspectRatio ratio={1}>
          <img
            src="/avatar.jpg"
            alt=""
            aria-hidden="true"
            className="h-full w-full rounded-full object-cover"
          />
        </AspectRatio>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("a video element inside AspectRatio has no axe violations", async () => {
    // axe attempts to step into iframes and fails in happy-dom for any
    // src. Use <video> with a track to exercise the same a11y surface
    // (alternative-text-bearing media element).
    const { container } = renderWithProviders(
      <main>
        <AspectRatio ratio={4 / 3}>
          <video
            aria-label="Demo video"
            controls
            className="h-full w-full"
          >
            <track kind="captions" />
          </video>
        </AspectRatio>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("multiple aspect-ratio thumbnails in a grid have no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <ul className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((id) => (
            <li key={id}>
              <AspectRatio ratio={1}>
                <img
                  src={`/thumb-${id}.jpg`}
                  alt={`Item ${id}`}
                  className="h-full w-full object-cover"
                />
              </AspectRatio>
            </li>
          ))}
        </ul>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
