// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReportCompletenessNotice } from "../report-completeness";

afterEach(() => cleanup());

describe("ReportCompletenessNotice", () => {
  it("renders nothing for a complete report", () => {
    const { container } = render(<ReportCompletenessNotice warnings={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it("renders display-safe completeness descriptions", () => {
    render(
      <ReportCompletenessNotice
        warnings={[
          {
            code: "USER_ACCOUNT_DIRECTORY_UNAVAILABLE",
            description: "Administrator filtering may be incomplete.",
          },
        ]}
      />,
    );

    expect(screen.getByText("Report completeness")).toBeTruthy();
    expect(
      screen.getByText("Administrator filtering may be incomplete."),
    ).toBeTruthy();
    expect(screen.queryByText("USER_ACCOUNT_DIRECTORY_UNAVAILABLE")).toBeNull();
  });
});
