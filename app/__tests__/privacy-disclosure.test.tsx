// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PrivacyPolicy from "@/app/privacy/page";

describe("public privacy disclosure", () => {
  it("explains the Supported Creator Channel data flow and its external gates", () => {
    render(<PrivacyPolicy />);

    expect(
      screen.getByRole("heading", {
        name: "Supported Creator Channel assistance",
      }),
    ).toBeTruthy();

    const content = document.body.textContent ?? "";
    expect(content).toMatch(/comment assessment/i);
    expect(content).toMatch(/server-side.*model provider/i);
    expect(content).toMatch(/author names.*avatars.*Channel IDs.*not sent/i);
    expect(content).toMatch(/30 calendar days/i);
    expect(content).toMatch(/refresh.*delete/i);
    expect(content).toMatch(/disconnect.*revoke/i);
    expect(content).toMatch(/private assistance/i);
    expect(content).toMatch(/per-item final review/i);
    expect(content).toMatch(/seven-day read-only grace period/i);
    expect(content).toMatch(/in-app.*delete/i);
    expect(content).toMatch(/after.*grant.*provenance.*YouTube/i);
    expect(content).toMatch(/Google OAuth verification/i);
    expect(content).toMatch(/written YouTube clearance/i);
  });
});
