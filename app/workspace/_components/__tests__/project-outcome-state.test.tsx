// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProjectOutcomeState } from "@/app/workspace/_components/project-outcome-state";

describe("ProjectOutcomeState", () => {
  it("gives accounts outside the invited beta a non-looping exit", () => {
    render(<ProjectOutcomeState kind="beta_unavailable" />);

    expect(
      screen.getByRole("heading", { name: "Projects are in invited beta" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Back to Dashboard" }).getAttribute("href"),
    ).toBe("/dashboard");
  });
});
