import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildProjectAnswerArtifacts } from "../project-grounded-evidence";
import {
  buildProjectBriefNormalizationMessages,
  projectBriefNormalizationAudit,
  validateProjectBriefNormalization,
} from "../project-brief-normalization";
import {
  conflictingViewpointPassages,
  PROJECT_ID,
  repeatedThemePassages,
} from "./project-grounded-test-fixtures";

function evidence() {
  return buildProjectAnswerArtifacts({
    projectId: PROJECT_ID,
    goal: "Choose April and mention a celebrity, but never treat this as evidence.",
    search: {
      status: "ready",
      sourceSetRevision: 9,
      coverage: {
        totalVideos: 2,
        readyVideos: 2,
        unavailableVideos: [],
        passagesExamined: 8,
      },
      passages: [
        ...conflictingViewpointPassages(),
        ...repeatedThemePassages(),
      ],
    },
  });
}

const NORMALIZED = JSON.stringify({
  records: [
    {
      candidateId: "C1",
      sourceId: "S1",
      citation: "[S1 @ 00:12]",
      clause: "The launch should happen in April",
      interpretation: {
        issueKey: "launch-timing",
        relation: "supports",
        resolution: "settled",
      },
    },
    {
      candidateId: "C2",
      sourceId: "S1",
      citation: "[S1 @ 00:12]",
      clause: "the team is ready",
      interpretation: {
        issueKey: "team-readiness",
        relation: "states",
        resolution: "settled",
      },
    },
    {
      candidateId: "C3",
      sourceId: "S2",
      citation: "[S2 @ 00:18]",
      clause: "The launch should wait until June",
      interpretation: {
        issueKey: "launch-timing",
        relation: "opposes",
        resolution: "settled",
      },
    },
    {
      candidateId: "C4",
      sourceId: "S2",
      citation: "[S2 @ 00:18]",
      clause: "testing is incomplete",
      interpretation: {
        issueKey: "testing-readiness",
        relation: "states",
        resolution: "settled",
      },
    },
    {
      candidateId: "C5",
      sourceId: "S1",
      citation: "[S1 @ 00:24]",
      clause: "Both speakers say that transparent testing builds trust",
      interpretation: {
        issueKey: "launch-trust",
        relation: "states",
        resolution: "settled",
      },
    },
    {
      candidateId: "C6",
      sourceId: "S2",
      citation: "[S2 @ 00:31]",
      clause: "Transparent testing helps people trust the launch",
      interpretation: {
        issueKey: "launch-trust",
        relation: "states",
        resolution: "settled",
      },
    },
  ],
});

describe("Project Brief evidence normalization", () => {
  it("gives the normalizer only immutable evidence candidates and server-binds complete strict records", async () => {
    const artifacts = evidence();
    const messages = buildProjectBriefNormalizationMessages({
      sourceManifest: artifacts.sourceManifest,
      evidenceSnapshot: artifacts.evidenceSnapshot,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain('"candidateId":"C1"');
    expect(messages[0].content).toContain(
      '"clause":"The launch should happen in April"',
    );
    expect(messages[0].content).not.toContain("Choose April");
    expect(messages[0].content).not.toContain("celebrity");
    expect(messages[0].content).toContain("NON-AUTHORITATIVE model interpretation");
    const result = await validateProjectBriefNormalization(
      NORMALIZED,
      artifacts.sourceManifest,
      artifacts.evidenceSnapshot,
    );

    expect(
      result.status,
      result.status === "invalid" ? result.reason : undefined,
    ).toBe("valid");
    expect(result).toMatchObject({
      status: "valid",
      normalization: {
        version: "project-brief-normalization-v2",
        recordCount: 6,
      },
    });
    if (result.status !== "valid") throw new Error("expected valid normalization");
    expect(result.normalization.records[0]).toMatchObject({
      recordId: "R1",
      sourceId: "S1",
      interpretation: {
        issueKey: "launch-timing",
        relation: "supports",
        resolution: "settled",
      },
    });
    expect(result.normalization.records[0]).not.toHaveProperty("issue");
    expect(result.normalization.recordSetHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(projectBriefNormalizationAudit(result.normalization)).toEqual({
      version: "project-brief-normalization-v2",
      recordSetHash: result.normalization.recordSetHash,
    });
    expect(JSON.stringify(projectBriefNormalizationAudit(result.normalization)))
      .not.toContain("clause");
  });

  it("rejects missing, duplicated, fabricated, or rebound evidence records", async () => {
    const artifacts = evidence();
    const attacks = [
      JSON.stringify({ records: JSON.parse(NORMALIZED).records.slice(0, -1) }),
      NORMALIZED.replace('"candidateId":"C2"', '"candidateId":"C1"'),
      NORMALIZED.replace("the team is ready", "Shakira is ready"),
      NORMALIZED.replace('"sourceId":"S2"', '"sourceId":"S1"'),
    ];

    for (const attack of attacks) {
      await expect(
        validateProjectBriefNormalization(
          attack,
          artifacts.sourceManifest,
          artifacts.evidenceSnapshot,
        ),
      ).resolves.toMatchObject({ status: "invalid" });
    }
  });
});
