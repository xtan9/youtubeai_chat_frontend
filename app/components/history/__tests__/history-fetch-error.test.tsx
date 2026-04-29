// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";
import { screen } from "@testing-library/react";
import { HistoryFetchError } from "../history-fetch-error";

describe("HistoryFetchError", () => {
  it("renders the supplied message", () => {
    renderWithProviders(<HistoryFetchError message="Couldn't load history" />);
    expect(screen.getByText("Couldn't load history")).toBeTruthy();
  });

  it("uses the alert role for assistive tech", () => {
    renderWithProviders(<HistoryFetchError message="x" />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
