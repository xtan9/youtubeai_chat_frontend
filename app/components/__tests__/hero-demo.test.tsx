// @vitest-environment happy-dom
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/hooks/useAnonSession", () => ({
  useAnonSession: () => ({ anonSession: { access_token: "mock" }, isLoading: false }),
}));

vi.mock("@/app/summary/components/chat-tab", () => ({
  ChatTab: ({ youtubeUrl }: { youtubeUrl: string | null }) => (
    <div data-testid="chat-tab" data-yturl={youtubeUrl ?? ""} />
  ),
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

// next/image's StrictMode warning gets noisy in test env; stub to a plain img
vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} />
  ),
}));

import HeroDemo from "../hero-demo";

afterEach(() => cleanup());

describe("HeroDemo carousel", () => {
  it("renders sample 1 active by default", async () => {
    render(<HeroDemo />);
    await waitFor(() => {
      // Active sample title appears in the Col 1 heading
      expect(
        screen.getByRole("heading", { name: /Will Nvidia/i }),
      ).toBeTruthy();
    });
    const sample1Card = screen.getByRole("button", { name: /Will Nvidia/i });
    expect(sample1Card.getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking another sample updates aria-pressed and ChatTab youtubeUrl", async () => {
    render(<HeroDemo />);
    const sample2 = await screen.findByRole("button", {
      name: /Master Your Sleep/i,
    });
    fireEvent.click(sample2);

    await waitFor(() => {
      expect(sample2.getAttribute("aria-pressed")).toBe("true");
    });

    const sample1 = screen.getByRole("button", { name: /Will Nvidia/i });
    expect(sample1.getAttribute("aria-pressed")).toBe("false");

    const chat = screen.getByTestId("chat-tab");
    expect(chat.getAttribute("data-yturl")).toBe(
      "https://www.youtube.com/watch?v=nm1TxQj9IsQ",
    );
  });
});

describe("HeroDemo Col 2 tabs", () => {
  it("renders the Summary tab by default with cached markdown", async () => {
    render(<HeroDemo />);
    // The Jensen summary's TL;DR uses the canonical "Jensen Huang argues"
    // phrasing baked into the cache.
    await waitFor(
      () => {
        expect(
          screen.getByText(/Jensen Huang argues/i),
        ).toBeTruthy();
      },
      { timeout: 2000 },
    );
  });

  it("switches to Transcript and shows mm:ss timestamp pills", async () => {
    const user = userEvent.setup();
    render(<HeroDemo />);
    await waitFor(() => screen.getByText(/Jensen Huang argues/i), {
      timeout: 2000,
    });

    const tab = screen.getByRole("tab", { name: /Transcript/i });
    await user.click(tab);

    await waitFor(() => {
      expect(tab.getAttribute("data-state")).toBe("active");
    });

    // First segment of any sample formats to "0:00".
    const pills = screen.getAllByText(
      (content) => content.trim() === "0:00",
    );
    expect(pills.length).toBeGreaterThan(0);
  });

  it("renders 'View full summary' deep-link to /summary", async () => {
    render(<HeroDemo />);
    await waitFor(() => screen.getByText(/Jensen Huang argues/i), {
      timeout: 2000,
    });
    const link = screen.getByText(/View full summary on \/summary/);
    expect(link.getAttribute("href")).toContain("/summary?url=");
    expect(link.getAttribute("href")).toContain("Hrbq66XqtCo");
  });
});
