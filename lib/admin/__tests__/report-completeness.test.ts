import { describe, expect, it } from "vitest";
import {
  reportCompletenessWarning,
  REPORT_COMPLETENESS_DESCRIPTIONS,
  REPORT_COMPLETENESS_WARNING_CODES,
} from "../report-completeness";

describe("Report Completeness warning contract", () => {
  it("gives every warning a machine-readable code and display-safe description", () => {
    for (const code of Object.values(REPORT_COMPLETENESS_WARNING_CODES)) {
      const warning = reportCompletenessWarning(code);

      expect(warning.code).toMatch(/^[A-Z0-9_]+$/);
      expect(warning.description).toBe(REPORT_COMPLETENESS_DESCRIPTIONS[code]);
      expect(warning.description.trim()).not.toBe("");
      expect(warning.description).not.toMatch(/[<>\r\n]/);
      expect(() => JSON.stringify(warning)).not.toThrow();
    }
  });
});
