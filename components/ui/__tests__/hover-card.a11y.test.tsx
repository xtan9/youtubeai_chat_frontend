// @vitest-environment happy-dom
// Test fixture uses a raw <img> tag because HoverCard's typical consumer
// usage involves consumer-supplied <img> or framework <Image />. Either
// works for the a11y scan; raw <img> keeps the test framework-agnostic.
/* eslint-disable @next/next/no-img-element */
import { describe, it, expect } from "vitest";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { axe, axePortal } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("HoverCard a11y", () => {
  it("trigger only (closed card) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <HoverCard>
          <HoverCardTrigger asChild>
            <a href="/u/jane">@jane</a>
          </HoverCardTrigger>
          <HoverCardContent>preview</HoverCardContent>
        </HoverCard>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("open hover-card with avatar + meta has no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <main>
        <HoverCard defaultOpen>
          <HoverCardTrigger asChild>
            <a href="/u/jane">@jane</a>
          </HoverCardTrigger>
          <HoverCardContent>
            <div>
              <img src="/avatar.jpg" alt="" aria-hidden="true" />
              <p className="text-sm font-semibold">Jane Doe</p>
              <p className="text-xs">UX engineer</p>
            </div>
          </HoverCardContent>
        </HoverCard>
      </main>,
    );
    const results = await axePortal(baseElement);
    expect(results).toHaveNoViolations();
  });

  it("open hover-card with side=right align=start has no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <main>
        <HoverCard defaultOpen>
          <HoverCardTrigger asChild>
            <a href="/help">Help</a>
          </HoverCardTrigger>
          <HoverCardContent side="right" align="start">
            Help text in the card.
          </HoverCardContent>
        </HoverCard>
      </main>,
    );
    const results = await axePortal(baseElement);
    expect(results).toHaveNoViolations();
  });

  it("hover-card with interactive content (link inside) has no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <main>
        <HoverCard defaultOpen>
          <HoverCardTrigger asChild>
            <a href="/source/1">[1]</a>
          </HoverCardTrigger>
          <HoverCardContent>
            <p>Author, 2025.</p>
            <a href="/source/1/full">Read full</a>
          </HoverCardContent>
        </HoverCard>
      </main>,
    );
    const results = await axePortal(baseElement);
    expect(results).toHaveNoViolations();
  });
});
