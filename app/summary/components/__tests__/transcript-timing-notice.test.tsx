// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TranscriptTimingNotice } from "../transcript-timing-notice";

afterEach(() => cleanup());

describe("TranscriptTimingNotice", () => {
  it.each([
    {
      status: "unavailable" as const,
      copy: "Transcript timing is unavailable",
    },
    {
      status: "not_requested" as const,
      copy: "Transcript timing was not requested",
    },
  ])("explains why seeking is unavailable for $status", ({ status, copy }) => {
    render(<TranscriptTimingNotice status={status} />);

    const notice = screen.getByRole("status");
    expect(notice.getAttribute("data-transcript-status")).toBe(status);
    expect(notice.textContent).toContain(copy);
    expect(notice.textContent).toMatch(/seeking is unavailable/i);
  });
});
