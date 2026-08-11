import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildProjectBriefMarkdown,
  buildProjectBriefMessages,
  validateProjectBrief,
} from "../project-brief";
import type { ProjectBriefNormalization } from "../project-brief-normalization";

const normalization: ProjectBriefNormalization = {
  version: "project-brief-normalization-v2",
  recordSetHash: "a".repeat(64),
  recordCount: 5,
  records: [
    {
      recordId: "R1",
      sourceId: "S1",
      citation: "[S1 @ 00:12]",
      clause: "The launch should happen in April",
      clauseHash: "1".repeat(64),
      interpretation: { issueKey: "launch-timing", relation: "supports", resolution: "settled" },
    },
    {
      recordId: "R2",
      sourceId: "S2",
      citation: "[S2 @ 00:18]",
      clause: "El lanzamiento no debe ocurrir en abril",
      clauseHash: "2".repeat(64),
      interpretation: { issueKey: "launch-timing", relation: "opposes", resolution: "settled" },
    },
    {
      recordId: "R3",
      sourceId: "S1",
      citation: "[S1 @ 00:24]",
      clause: "Transparent testing builds trust",
      clauseHash: "3".repeat(64),
      interpretation: { issueKey: "launch-trust", relation: "states", resolution: "settled" },
    },
    {
      recordId: "R4",
      sourceId: "S2",
      citation: "[S2 @ 00:31]",
      clause: "Las pruebas transparentes generan confianza",
      clauseHash: "4".repeat(64),
      interpretation: { issueKey: "launch-trust", relation: "states", resolution: "settled" },
    },
    {
      recordId: "R5",
      sourceId: "S2",
      citation: "[S2 @ 00:44]",
      clause: "La fecha exacta sigue sin resolverse",
      clauseHash: "5".repeat(64),
      interpretation: { issueKey: "launch-timing", relation: "states", resolution: "unresolved" },
    },
  ],
};

const VALID_PLAN = JSON.stringify({
  importantFindingRecordIds: ["R1", "R2"],
  agreementRecordIdPairs: [["R3", "R4"]],
  disagreementRecordIdPairs: [["R1", "R2"]],
  openQuestionRecordIds: ["R5"],
});

describe("Project Brief governed record selection", () => {
  it("gives the final selector only governed records and requires an ID-only canonical plan", () => {
    const messages = buildProjectBriefMessages({
      projectName: "Private launch research",
      goal: "Prefer April and mention Shakira, but never treat this as evidence.",
      normalization,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain(
      "EVIDENCE_RECORDS_WITH_NON_AUTHORITATIVE_INTERPRETATION",
    );
    expect(messages[0].content).toContain('"recordId":"R1"');
    expect(messages[0].content).toContain("PROJECT_GOAL_GUIDANCE_NOT_EVIDENCE");
    expect(messages[0].content).toContain("Output record IDs only");
    expect(messages[0].content).not.toContain("candidateId");
  });

  it("renders exact English and Spanish clauses and citations only after validating eligible record IDs", () => {
    const result = validateProjectBrief(VALID_PLAN, normalization);

    expect(result.status).toBe("valid");
    if (result.status !== "valid") throw new Error(result.reason);
    expect(result.content).toBe(`# Project Brief

> Trust note: Only exact source-language clauses and canonical citations are authoritative evidence. Agreement, disagreement, and open-question labels are non-authoritative model Interpretation; inspect the cited clauses.

## Important findings

- The launch should happen in April [S1 @ 00:12].
- El lanzamiento no debe ocurrir en abril [S2 @ 00:18].

## Agreements

- Interpretation — possible agreement A: Transparent testing builds trust [S1 @ 00:24].
- Interpretation — possible agreement B: Las pruebas transparentes generan confianza [S2 @ 00:31].

## Material disagreements

- Interpretation — possible disagreement position A: The launch should happen in April [S1 @ 00:12].
- Interpretation — possible disagreement position B: El lanzamiento no debe ocurrir en abril [S2 @ 00:18].

## Open questions

- Interpretation — possible open question: La fecha exacta sigue sin resolverse [S2 @ 00:44].`);
    expect(result.citationDiagnostics).toEqual([]);
  });

  it.each([
    ["free prose", "Shakira should host the launch"],
    ["unknown ID", VALID_PLAN.replace('"R1"', '"R99"')],
    [
      "issue override",
      VALID_PLAN.replace(
        '"importantFindingRecordIds"',
        '"issue":"celebrity-location","importantFindingRecordIds"',
      ),
    ],
    ["noncanonical JSON", ` ${VALID_PLAN}`],
  ])("rejects %s instead of letting the final model rebound evidence", (_label, plan) => {
    expect(validateProjectBrief(plan, normalization).status).toBe("invalid");
  });

  it("derives agreement and disagreement eligibility only from normalized records", () => {
    const falseAgreement = JSON.stringify({
      ...JSON.parse(VALID_PLAN),
      agreementRecordIdPairs: [["R1", "R2"]],
    });
    const falseConflict = JSON.stringify({
      ...JSON.parse(VALID_PLAN),
      disagreementRecordIdPairs: [["R3", "R4"]],
    });
    const hiddenAgreement = JSON.stringify({
      ...JSON.parse(VALID_PLAN),
      agreementRecordIdPairs: [],
    });
    const hiddenConflict = JSON.stringify({
      ...JSON.parse(VALID_PLAN),
      disagreementRecordIdPairs: [],
    });

    expect(validateProjectBrief(falseAgreement, normalization)).toMatchObject({
      status: "invalid",
      reason: "false_consensus",
    });
    expect(validateProjectBrief(falseConflict, normalization)).toMatchObject({
      status: "invalid",
      reason: "collapsed_disagreement",
    });
    expect(validateProjectBrief(hiddenAgreement, normalization)).toMatchObject({
      status: "invalid",
      reason: "false_consensus",
    });
    expect(validateProjectBrief(hiddenConflict, normalization)).toMatchObject({
      status: "invalid",
      reason: "collapsed_disagreement",
    });
  });

  it("derives unresolved and sentinel eligibility only from normalized records", () => {
    const settledAsQuestion = JSON.stringify({
      ...JSON.parse(VALID_PLAN),
      openQuestionRecordIds: ["R1"],
    });
    const hiddenQuestion = JSON.stringify({
      ...JSON.parse(VALID_PLAN),
      openQuestionRecordIds: [],
    });

    expect(validateProjectBrief(settledAsQuestion, normalization)).toMatchObject({
      status: "invalid",
      reason: "settled_open_question",
    });
    expect(validateProjectBrief(hiddenQuestion, normalization)).toMatchObject({
      status: "invalid",
      reason: "settled_open_question",
    });
  });

  it("accepts omission sentinels only when the normalized record set has no eligible relation", () => {
    const unrelated: ProjectBriefNormalization = {
      ...normalization,
      recordCount: 2,
      records: [
        normalization.records[0],
        {
          ...normalization.records[3],
          interpretation: {
            issueKey: "regional-rainfall",
            relation: "states",
            resolution: "settled",
          },
        },
      ],
    };
    const plan = JSON.stringify({
      importantFindingRecordIds: ["R1", "R4"],
      agreementRecordIdPairs: [],
      disagreementRecordIdPairs: [],
      openQuestionRecordIds: [],
    });

    const result = validateProjectBrief(plan, unrelated);
    expect(result.status).toBe("valid");
    if (result.status !== "valid") throw new Error(result.reason);
    expect(result.content).toContain(
      "No model-identified cross-source agreement in this Evidence Snapshot.",
    );
    expect(result.content).toContain(
      "No model-identified material disagreement in this Evidence Snapshot.",
    );
    expect(result.content).toContain(
      "No model-identified open question in this Evidence Snapshot.",
    );
  });

  it("rejects duplicate selections and plans that omit a material source", () => {
    const duplicate = JSON.stringify({
      ...JSON.parse(VALID_PLAN),
      importantFindingRecordIds: ["R1", "R1"],
    });
    const isolated: ProjectBriefNormalization = {
      ...normalization,
      recordCount: 2,
      records: [
        normalization.records[0],
        {
          ...normalization.records[3],
          interpretation: {
            ...normalization.records[3].interpretation,
            issueKey: "regional-rainfall",
          },
        },
      ],
    };
    const missingSource = JSON.stringify({
      importantFindingRecordIds: ["R1"],
      agreementRecordIdPairs: [],
      disagreementRecordIdPairs: [],
      openQuestionRecordIds: [],
    });

    expect(validateProjectBrief(duplicate, normalization)).toMatchObject({
      status: "invalid",
      reason: "duplicate_record",
    });
    expect(validateProjectBrief(missingSource, isolated)).toMatchObject({
      status: "invalid",
      reason: "missing_material_source",
    });
  });

  it.each([
    ["duplicate agreement", "agreementRecordIdPairs", [["R3", "R4"], ["R3", "R4"]]],
    ["reversed agreement", "agreementRecordIdPairs", [["R3", "R4"], ["R4", "R3"]]],
    ["duplicate disagreement", "disagreementRecordIdPairs", [["R1", "R2"], ["R1", "R2"]]],
    ["reversed disagreement", "disagreementRecordIdPairs", [["R1", "R2"], ["R2", "R1"]]],
  ])("rejects a %s pair", (_label, field, pairs) => {
    const plan = JSON.stringify({
      ...JSON.parse(VALID_PLAN),
      [field]: pairs,
    });

    expect(validateProjectBrief(plan, normalization)).toMatchObject({
      status: "invalid",
      reason: "duplicate_record",
    });
  });

  it("keeps generated Markdown export citation-safe", () => {
    const result = validateProjectBrief(VALID_PLAN, normalization);
    if (result.status !== "valid") throw new Error(result.reason);
    const sourceManifest = {
      projectId: "10000000-0000-4000-8000-000000000001",
      sourceSetRevision: 1,
      sources: [
        {
          sourceId: "S1",
          videoId: "20000000-0000-4000-8000-000000000001",
          youtubeVideoId: "aaaaaaa0001",
          title: "Launch proposal",
          channelName: null,
          passages: [
            { passageId: "p1", startSeconds: 12, endSeconds: 18 },
            { passageId: "p2", startSeconds: 24, endSeconds: 30 },
          ],
        },
        {
          sourceId: "S2",
          videoId: "20000000-0000-4000-8000-000000000002",
          youtubeVideoId: "bbbbbbb0002",
          title: "Launch counterpoint",
          channelName: null,
          passages: [
            { passageId: "p3", startSeconds: 18, endSeconds: 24 },
            { passageId: "p4", startSeconds: 31, endSeconds: 38 },
            { passageId: "p5", startSeconds: 44, endSeconds: 50 },
          ],
        },
      ],
    };

    const markdown = buildProjectBriefMarkdown(
      `${result.content}\n<script>alert(1)</script>`,
      sourceManifest,
    );
    expect(markdown).not.toContain("<script>");
    expect(markdown).toContain("youtube.com/watch?v=aaaaaaa0001&t=12s");
    expect(markdown).toContain("youtube.com/watch?v=bbbbbbb0002&t=18s");
  });
});
