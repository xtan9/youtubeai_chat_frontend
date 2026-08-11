// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProjectOutcomeState } from "@/app/workspace/_components/project-outcome-state";

describe("ProjectOutcomeState", () => {
  it("gives anonymous visitors a direct registration path", () => {
    render(<ProjectOutcomeState kind="anonymous" />);

    expect(
      screen.getByRole("heading", { name: "Create an account for Projects" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Create free account" }).getAttribute("href"),
    ).toBe("/auth/sign-up?redirect_to=%2Fworkspace");
  });
});
