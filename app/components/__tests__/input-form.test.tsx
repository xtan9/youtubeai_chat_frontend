// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputForm } from "../input-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent: vi.fn(),
}));

afterEach(() => cleanup());

describe("InputForm", () => {
  it.each(["clear", "edit"])(
    "clears the previous URL validation error when the Learner chooses to %s",
    (recovery) => {
      render(<InputForm />);

      const input = screen.getByRole("textbox", { name: "YouTube URL" });
      fireEvent.change(input, {
        target: { value: "https://example.com/not-a-video" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Summarize video" }));
      expect(screen.getByRole("alert").textContent).toContain(
        "Please enter a valid YouTube URL",
      );

      if (recovery === "clear") {
        fireEvent.click(screen.getByRole("button", { name: "Clear input" }));
      } else {
        fireEvent.change(input, {
          target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
        });
      }

      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("falls back to the Summary GET route before client hydration", () => {
    render(<InputForm />);

    const form = screen.getByRole("button", { name: "Summarize video" }).closest(
      "form",
    );

    expect(form?.getAttribute("action")).toBe("/summary");
    expect(form?.getAttribute("method")).toBe("get");
    expect(
      screen.getByRole("textbox", { name: "YouTube URL" }).getAttribute("name"),
    ).toBe("url");
  });

  it("keeps the compact summarize button 24px from the end edge", () => {
    render(<InputForm variant="compact" />);

    const button = screen.getByRole("button", { name: "Summarize video" });
    const compactLayout = button.parentElement;

    expect(compactLayout?.classList.contains("pe-6")).toBe(true);
    expect(compactLayout?.classList.contains("pe-2")).toBe(false);
  });
});
