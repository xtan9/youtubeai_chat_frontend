// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@/components/ui/avatar";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Avatar a11y", () => {
  it("avatar with image + fallback has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Avatar>
          <AvatarImage src="/u.jpg" alt="Jane Doe" />
          <AvatarFallback>JD</AvatarFallback>
        </Avatar>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("fallback-only avatar has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Avatar>
          <AvatarFallback>U</AvatarFallback>
        </Avatar>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("decorative avatar (aria-hidden) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Avatar aria-hidden="true">
          <AvatarFallback>U</AvatarFallback>
        </Avatar>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
