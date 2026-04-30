// @vitest-environment happy-dom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";
import { HistoryAnonEmpty } from "../HistoryAnonEmpty";

afterEach(cleanup);

describe("HistoryAnonEmpty", () => {
  it("renders the heading", () => {
    render(<HistoryAnonEmpty />);
    expect(
      screen.getByRole("heading", { name: /save and revisit your summaries/i }),
    ).not.toBeNull();
  });

  it("provides a signup link with redirect_to=/history", () => {
    render(<HistoryAnonEmpty />);
    const links = screen.getAllByRole("link");
    const signupLink = links.find((a) =>
      a.getAttribute("href")?.startsWith("/auth/sign-up"),
    );
    expect(signupLink).not.toBeNull();
    expect(signupLink?.getAttribute("href")).toContain("redirect_to=/history");
  });

  it("exposes the paywall variant data attribute", () => {
    const { container } = render(<HistoryAnonEmpty />);
    expect(
      container.querySelector('[data-paywall-variant="history-anon"]'),
    ).not.toBeNull();
  });
});
