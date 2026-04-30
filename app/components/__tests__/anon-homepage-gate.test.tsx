// @vitest-environment happy-dom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi, type Mock } from "vitest";
import { useEntitlements } from "@/lib/hooks/useEntitlements";
import { AnonHomepageGate } from "../anon-homepage-gate";

afterEach(cleanup);

vi.mock("@/lib/hooks/useEntitlements", () => ({
  useEntitlements: vi.fn(),
}));

describe("AnonHomepageGate", () => {
  it("renders AnonSignupWall when anon user has hit the summary cap", () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: {
        tier: "anon",
        caps: { summariesUsed: 1, summariesLimit: 1 },
      },
    });

    render(<AnonHomepageGate />);
    expect(screen.getByText(/try unlimited free/i)).not.toBeNull();
  });

  it("renders nothing when anon user has NOT yet hit the cap", () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: {
        tier: "anon",
        caps: { summariesUsed: 0, summariesLimit: 1 },
      },
    });

    const { container } = render(<AnonHomepageGate />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a free (signed-in) user", () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: {
        tier: "free",
        caps: { summariesUsed: 10, summariesLimit: 10 },
      },
    });

    const { container } = render(<AnonHomepageGate />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while entitlements are loading (data is undefined)", () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: undefined,
    });

    const { container } = render(<AnonHomepageGate />);
    expect(container.firstChild).toBeNull();
  });
});
