// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
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
