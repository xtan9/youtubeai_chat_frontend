import { describe, expect, it } from "vitest";

import {
  buildSafetyFlagDefaultExport,
  createProtectedSafetyEvidence,
  getSafetyEvidenceForBoundary,
  revealSafetyEvidence,
  SAFETY_EVIDENCE_REVEAL_WARNING,
} from "../sensitive-evidence";

const RAW_EVIDENCE =
  "Email me at steward@example.com, call +1 (415) 555-2671, or visit 123 Main Street, San Francisco. The child attends Lincoln High School. Passport number X12345678. GPS 37.7749,-122.4194.";

describe("protected Safety Flag evidence", () => {
  it("masks contact, address, school, identity-document, and comparable location evidence", () => {
    const evidence = createProtectedSafetyEvidence(RAW_EVIDENCE);

    expect(evidence.maskedText).not.toContain("steward@example.com");
    expect(evidence.maskedText).not.toContain("+1 (415) 555-2671");
    expect(evidence.maskedText).not.toContain("123 Main Street");
    expect(evidence.maskedText).not.toContain("Lincoln High School");
    expect(evidence.maskedText).not.toContain("X12345678");
    expect(evidence.maskedText).not.toContain("37.7749,-122.4194");
    expect(evidence.redactionCount).toBeGreaterThanOrEqual(6);
    expect(evidence.categories).toEqual(
      expect.arrayContaining([
        "email",
        "phone",
        "address",
        "school",
        "identity_document",
        "location",
      ]),
    );
  });

  it("uses the masked projection for model, log, draft, and default-export boundaries", () => {
    const evidence = createProtectedSafetyEvidence(RAW_EVIDENCE);

    for (const boundary of ["model", "log", "draft", "default_export"] as const) {
      expect(getSafetyEvidenceForBoundary(evidence, boundary)).toBe(
        evidence.maskedText,
      );
      expect(getSafetyEvidenceForBoundary(evidence, boundary)).not.toContain(
        "steward@example.com",
      );
    }

    expect(JSON.stringify(evidence)).not.toContain(RAW_EVIDENCE);
  });

  it("requires a warned deliberate action before revealing raw evidence", () => {
    const evidence = createProtectedSafetyEvidence(RAW_EVIDENCE);
    expect(SAFETY_EVIDENCE_REVEAL_WARNING).toMatch(/personal information/i);

    expect(() =>
      revealSafetyEvidence(evidence, {
        warningAcknowledged: false,
        purpose: "youtube_enforcement",
      }),
    ).toThrow(/warning/i);
    expect(() =>
      revealSafetyEvidence(evidence, {
        warningAcknowledged: true,
        purpose: "unapproved_purpose" as never,
      }),
    ).toThrow(/purpose/i);

    expect(
      revealSafetyEvidence(evidence, {
        warningAcknowledged: true,
        purpose: "youtube_enforcement",
      }),
    ).toEqual({
      text: RAW_EVIDENCE,
      purpose: "youtube_enforcement",
    });

    expect(Object.isFrozen(evidence)).toBe(true);
  });

  it("keeps a default Safety Flag export private and draft-free", () => {
    const evidence = createProtectedSafetyEvidence(RAW_EVIDENCE);
    const exported = buildSafetyFlagDefaultExport({
      id: "flag-1",
      reasons: ["doxxing", "minor_risk"],
      evidence,
    });

    expect(exported).toMatchObject({
      id: "flag-1",
      classification: "Safety Flag",
      reasons: ["doxxing", "minor_risk"],
      evidence: evidence.maskedText,
      replyDraft: null,
    });
    expect(JSON.stringify(exported)).not.toContain(RAW_EVIDENCE);
  });
});
