import { describe, expect, it } from "vitest";
import { ProjectCitationDiagnosticSchema } from "../project-grounded-answer-contract";

describe("Project Grounded Answer contract Unicode bounds", () => {
  it("bounds diagnostic raw text by Unicode code points", () => {
    expect(
      ProjectCitationDiagnosticSchema.safeParse({
        kind: "malformed",
        raw: "😀".repeat(80),
      }).success,
    ).toBe(true);
    expect(
      ProjectCitationDiagnosticSchema.safeParse({
        kind: "malformed",
        raw: "😀".repeat(81),
      }).success,
    ).toBe(false);
  });
});
