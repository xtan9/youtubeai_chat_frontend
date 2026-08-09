import { describe, expect, it } from "vitest";
import {
  inspectProjectCitations,
  parseProjectCitations,
} from "../project-grounded-citations";
import { manifest } from "./project-grounded-test-fixtures";

describe("Project Grounded Answer citation validation", () => {
  it("links only an exact source and Evidence Snapshot start timestamp", () => {
    const parts = parseProjectCitations(
      "Supported [S1 @ 00:42]. Unknown [S9 @ 00:10]. Wrong [S1 @ 00:43].",
      manifest(),
    );

    expect(parts.filter((part) => part.type === "citation")).toEqual([
      expect.objectContaining({
        raw: "[S1 @ 00:42]",
        href: "https://www.youtube.com/watch?v=aaaaaaa0001&t=42s",
      }),
    ]);
    expect(parts.filter((part) => part.type === "text").map((part) => part.value).join(""))
      .toContain("[S9 @ 00:10]");
    expect(parts.filter((part) => part.type === "text").map((part) => part.value).join(""))
      .toContain("[S1 @ 00:43]");
  });

  it("links an exact Evidence Snapshot timestamp range for the same source", () => {
    const parts = parseProjectCitations(
      "The launch detail spans [S1 @ 00:42-00:58].",
      manifest(),
    );

    expect(parts.filter((part) => part.type === "citation")).toEqual([
      expect.objectContaining({
        raw: "[S1 @ 00:42-00:58]",
        href: "https://www.youtube.com/watch?v=aaaaaaa0001&t=42s",
      }),
    ]);
    expect(
      inspectProjectCitations(
        "Wrong range [S1 @ 00:42-00:59].",
        manifest(),
      ).diagnostics,
    ).toEqual([
      {
        kind: "timestamp_not_in_evidence",
        raw: "[S1 @ 00:42-00:59]",
        sourceId: "S1",
      },
    ]);
  });

  it("classifies malformed, unknown, and wrong timestamps with a hard bound", () => {
    const repeatedMalformed = Array.from(
      { length: 25 },
      (_, index) => `[S1 at 00:${String(index).padStart(2, "0")}]`,
    ).join(" ");
    const inspection = inspectProjectCitations(
      `[S9 @ 00:10] [S1 @ 00:43] ${repeatedMalformed}`,
      manifest(),
    );

    expect(inspection.validCitationCount).toBe(0);
    expect(inspection.diagnostics.slice(0, 2)).toEqual([
      { kind: "unknown_source", raw: "[S9 @ 00:10]", sourceId: "S9" },
      {
        kind: "timestamp_not_in_evidence",
        raw: "[S1 @ 00:43]",
        sourceId: "S1",
      },
    ]);
    expect(inspection.diagnostics).toHaveLength(20);
    expect(inspection.diagnostics.some((item) => item.kind === "malformed"))
      .toBe(true);
  });

  it("never salvages nested or overlong malformed bracket candidates", () => {
    const overlong = `[S1 @ 00:42 ${"x".repeat(90)}]`;
    const content = `Nested [[S1 @ 00:42]] and long ${overlong}.`;
    const inspection = inspectProjectCitations(content, manifest());
    const parts = parseProjectCitations(content, manifest());

    expect(inspection.validCitationCount).toBe(0);
    expect(inspection.diagnostics).toEqual([
      { kind: "malformed", raw: "[[S1 @ 00:42]]" },
      { kind: "malformed", raw: overlong.slice(0, 80) },
    ]);
    expect(parts.some((part) => part.type === "citation")).toBe(false);
    expect(
      parts
        .map((part) => (part.type === "text" ? part.value : part.raw))
        .join(""),
    ).toBe(content);
  });

  it("requires a validated citation in every supported factual sentence", () => {
    expect(
      inspectProjectCitations(
        "The launch happened in April [S1 @ 00:42].",
        manifest(),
      ).allClaimsCited,
    ).toBe(true);
    expect(
      inspectProjectCitations(
        "The launch happened in April [S1 @ 00:42]. It also happened in May.",
        manifest(),
      ).allClaimsCited,
    ).toBe(false);
  });
});
