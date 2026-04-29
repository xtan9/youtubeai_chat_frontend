// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";
import { screen } from "@testing-library/react";
import { EmptyHistoryState } from "../empty-history-state";

describe("EmptyHistoryState", () => {
  it("renders the empty-state copy", () => {
    renderWithProviders(<EmptyHistoryState />);
    expect(
      screen.getByText(/haven't summarized any videos yet/i),
    ).toBeTruthy();
  });

  it("has status role for screen readers", () => {
    renderWithProviders(<EmptyHistoryState />);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
