// @vitest-environment happy-dom
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/hooks/useAnonSession", () => ({
  useAnonSession: () => ({
    anonSession: { access_token: "mock" },
    isLoading: false,
  }),
}));

vi.mock("@/app/summary/components/chat-tab", () => ({
  ChatTab: ({ youtubeUrl }: { youtubeUrl: string | null }) => (
    <div data-testid="chat-tab" data-yturl={youtubeUrl ?? ""} />
  ),
}));

vi.mock("@/app/summary/components/transcript-paragraphs", () => ({
  default: ({ segments }: { segments: ReadonlyArray<unknown> }) => (
    <div data-testid="transcript-stub" data-segcount={segments.length} />
  ),
}));

vi.mock("../hero-player", () => ({
  default: ({ videoId }: { videoId: string }) => (
    <div data-testid="hero-player" data-vid={videoId} />
  ),
}));

vi.mock("../hero-thumbnail-grid", () => ({
  default: ({
    samples,
    activeId,
    onSelect,
  }: {
    samples: ReadonlyArray<{ id: string; title: string }>;
    activeId: string;
    onSelect: (id: string) => void;
  }) => (
    <div data-testid="hero-grid">
      {samples.map((s) => (
        <button
          key={s.id}
          aria-pressed={s.id === activeId}
          aria-label={s.title}
          onClick={() => onSelect(s.id)}
        >
          {s.title}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

import HeroDemo from "../hero-demo";

afterEach(() => cleanup());

describe("HeroDemo", () => {
  it("activates sample 1 by default and renders its title", async () => {
    render(<HeroDemo />);
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /Will Nvidia/i }),
      ).toBeTruthy();
    });
    const sample1Btn = screen.getByRole("button", {
      name: /Will Nvidia/i,
    });
    expect(sample1Btn.getAttribute("aria-pressed")).toBe("true");
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

    const chat = screen.getByTestId("chat-tab");
    expect(chat.getAttribute("data-yturl")).toBe(
      "https://www.youtube.com/watch?v=nm1TxQj9IsQ",
    );
  });

  it("renders the English summary by default", async () => {
    render(<HeroDemo />);
    // The heading and grid buttons also match "Jensen Huang" — assert
    // on a phrase only present in the rendered markdown body so we
    // unambiguously verify the lazy-loaded summary landed.
    await waitFor(
      () => {
        expect(
          (document.body.textContent ?? "").includes("Jensen Huang argues"),
        ).toBe(true);
      },
      { timeout: 8000 },
    );
  });

  it("switches to the Transcript tab and renders the TranscriptParagraphs stub with full segments", async () => {
    const user = userEvent.setup();
    render(<HeroDemo />);
    await waitFor(
      () =>
        expect(
          (document.body.textContent ?? "").includes("Jensen Huang argues"),
        ).toBe(true),
      { timeout: 8000 },
    );

    const tab = screen.getByRole("tab", { name: /Transcript/i });
    await user.click(tab);

    await waitFor(() => {
      const stub = screen.getByTestId("transcript-stub");
      expect(Number(stub.getAttribute("data-segcount"))).toBeGreaterThan(100);
    });
  });

  it("language picker swaps the rendered summary and persists across sample switches", async () => {
    const user = userEvent.setup();
    render(<HeroDemo />);
    await waitFor(
      () =>
        expect(
          (document.body.textContent ?? "").includes("Jensen Huang argues"),
        ).toBe(true),
      { timeout: 8000 },
    );
    const englishBaseline = document.body.textContent ?? "";

    const trigger = screen.getByRole("button", { name: /Summary language/i });
    await user.click(trigger);

    const esOption = await screen.findByTestId("lang-option-es");
    await user.click(esOption);

    // Wait for the Spanish summary to land. We don't assert on a
    // specific Spanish phrase (the translated copy can drift); we just
    // assert the rendered summary text changed from the English
    // baseline.
    await waitFor(
      () => {
        const now = document.body.textContent ?? "";
        expect(now).not.toBe(englishBaseline);
      },
      { timeout: 8000 },
    );

    // Switch sample — language selection must persist.
    const sample2 = screen.getByRole("button", {
      name: /Master Your Sleep/i,
    });
    await user.click(sample2);
    await waitFor(() => {
      expect(sample2.getAttribute("aria-pressed")).toBe("true");
    });
    const triggerAfter = screen.getByRole("button", {
      name: /Summary language/i,
    });
    expect(triggerAfter.textContent).toMatch(/Español/);
  });

  it("recovers when loadSummary rejects: column 2 doesn't stay permanently faded out", async () => {
    // Mock SAMPLES so the active sample's loadSummary rejects on first
    // call. The component's catch branch must clear the fade so the
    // user isn't staring at an invisible column — losing setFading(false)
    // in the catch branch would silently regress this.
    vi.resetModules();
    vi.doMock("@/app/components/hero-demo-data", async () => {
      const actual = await vi.importActual<
        typeof import("@/app/components/hero-demo-data")
      >("@/app/components/hero-demo-data");
      return {
        ...actual,
        SAMPLES: [
          {
            id: "Hrbq66XqtCo",
            title: "Will Nvidia",
            channel: "C",
            durationSec: 100,
            loadBase: () =>
              Promise.resolve({
                id: "Hrbq66XqtCo",
                segments: [],
                nativeLanguage: "en",
              }),
            loadSummary: () => Promise.reject(new Error("simulated")),
          },
        ],
      };
    });
    const { default: HeroDemoMocked } = await import("../hero-demo");
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<HeroDemoMocked />);
    // Wait long enough for the 250ms fade-out → reject → fade-clear cycle.
    await new Promise((r) => setTimeout(r, 600));
    // Look for the column 2 wrapper — its opacity class should NOT be
    // opacity-0 anymore (the catch path called setFading(false)).
    const col = document.querySelector(".motion-safe\\:transition-opacity");
    expect(col?.className.includes("opacity-100")).toBe(true);
    vi.doUnmock("@/app/components/hero-demo-data");
  });
});
