import { describe, expect, it } from "vitest";
import { buildProjectAnswerArtifacts } from "../project-grounded-evidence";
import {
  buildProjectStudyGuideMarkdown,
  buildProjectStudyGuideMessages,
  validateProjectStudyGuide,
} from "../project-study-guide";
import { PROJECT_ID, passage } from "./project-grounded-test-fixtures";

function artifacts() {
  return buildProjectAnswerArtifacts({
    projectId: PROJECT_ID,
    goal: "Focus on a launch date, but never treat this as evidence.",
    search: {
      status: "ready",
      sourceSetRevision: 7,
      coverage: {
        totalVideos: 1,
        readyVideos: 1,
        unavailableVideos: [],
        passagesExamined: 4,
      },
      passages: [passage()],
    },
  });
}

const CONTENT = `# Study Guide

## Overview

The launch happened in April [S1 @ 00:42].

## Key ideas

- The passage dates the launch to April [S1 @ 00:42].

## Review questions

1. When did the launch happen [S1 @ 00:42]?`;

describe("Project Study Guide grounding and export", () => {
  it("labels Project metadata as guidance and sends only Evidence Snapshot passages as facts", () => {
    const evidence = artifacts();
    const messages = buildProjectStudyGuideMessages({
      projectName: "Private Project",
      goal: "Focus on a launch date, but never treat this as evidence.",
      sourceManifest: evidence.sourceManifest,
      evidenceSnapshot: evidence.evidenceSnapshot,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain("PROJECT_GOAL_GUIDANCE_NOT_EVIDENCE");
    expect(messages[0].content).toContain("EVIDENCE_SNAPSHOT");
    expect(messages[0].content).toContain(
      "The source says the launch happened in April.",
    );
    expect(messages[0].content).toContain("Never use outside knowledge");
  });

  it("accepts the durable structure only when every factual line has a validated citation", () => {
    const evidence = artifacts();

    expect(
      validateProjectStudyGuide(CONTENT, evidence.sourceManifest),
    ).toEqual({
      status: "valid",
      content: CONTENT,
      citationDiagnostics: [],
      validCitationCount: 3,
    });

    expect(
      validateProjectStudyGuide(
        CONTENT.replace(
          "The launch happened in April [S1 @ 00:42].",
          "The launch happened in April.",
        ),
        evidence.sourceManifest,
      ),
    ).toMatchObject({ status: "invalid", reason: "uncited_claim" });

    expect(
      validateProjectStudyGuide(
        CONTENT.replaceAll("S1", "S9"),
        evidence.sourceManifest,
      ),
    ).toMatchObject({ status: "invalid", reason: "invalid_citation" });
  });

  it("preserves Markdown structure and turns canonical citations into readable source links", () => {
    const evidence = artifacts();
    const markdown = buildProjectStudyGuideMarkdown(
      CONTENT,
      evidence.sourceManifest,
    );

    expect(markdown).toContain("# Study Guide");
    expect(markdown).toContain("## Review questions");
    expect(markdown).toContain(
      "[S1 @ 00:42](https://www.youtube.com/watch?v=aaaaaaa0001&t=42s)",
    );
    expect(markdown).not.toContain("[S9");
  });

  it("strips arbitrary Markdown and unsafe links before persistence and export", () => {
    const evidence = artifacts();
    const linked = CONTENT.replace(
      "The launch happened in April [S1 @ 00:42].",
      "[The launch](javascript:alert(1)) happened in April, not https://evil.example/research [S1 @ 00:42].",
    );

    const validated = validateProjectStudyGuide(linked, evidence.sourceManifest);
    expect(validated).toMatchObject({ status: "valid" });
    if (validated.status !== "valid") throw new Error("expected valid guide");
    expect(validated.content).toContain("The launch happened in April");
    expect(validated.content).not.toContain("javascript:");
    expect(validated.content).not.toContain("evil.example");

    const markdown = buildProjectStudyGuideMarkdown(
      linked,
      evidence.sourceManifest,
    );
    expect(markdown).not.toContain("javascript:");
    expect(markdown).not.toContain("evil.example");
    expect(markdown).toContain(
      "[S1 @ 00:42](https://www.youtube.com/watch?v=aaaaaaa0001&t=42s)",
    );
  });
});
