import { describe, expect, it } from "vitest";
import {
  PROJECT_GUIDED_ACTIONS,
  ProjectConversationModeSchema,
  buildProjectSynthesisAbstention,
  buildProjectSynthesisInstructions,
  getProjectGuidedAction,
  validateProjectSynthesisResponse,
} from "../project-grounded-synthesis";
import { buildProjectAnswerArtifacts } from "../project-grounded-evidence";
import { inspectProjectCitations } from "../project-grounded-citations";
import { buildProjectGroundedMessages } from "../project-grounded-prompt";
import {
  PROJECT_ID,
  VIDEO_TWO_ID,
  conflictingViewpointPassages,
  multilingualPassages,
  passage,
  repeatedThemePassages,
} from "./project-grounded-test-fixtures";
import {
  PROJECT_QUESTION_MAX_LENGTH,
  ProjectGroundedQuestionRequestSchema,
  projectGroundedQuestionCodePointLength,
} from "../project-grounded-answer-contract";

describe("Project guided synthesis contract", () => {
  it("keeps every built-in prompt inside the localized composer contract", () => {
    for (const action of PROJECT_GUIDED_ACTIONS) {
      expect(projectGroundedQuestionCodePointLength(action.question)).toBeLessThanOrEqual(
        PROJECT_QUESTION_MAX_LENGTH,
      );
      expect(
        ProjectGroundedQuestionRequestSchema.safeParse({
          questionId: "00000000-0000-4000-8000-000000000327",
          question: action.question,
          mode: action.mode,
        }).success,
      ).toBe(true);
    }

    const localizedQuestion = `${"证据🌍".repeat(50)}${"证据".repeat(25)}`;
    expect(localizedQuestion.length).toBeGreaterThan(PROJECT_QUESTION_MAX_LENGTH);
    expect(projectGroundedQuestionCodePointLength(localizedQuestion)).toBe(
      PROJECT_QUESTION_MAX_LENGTH,
    );
    expect(
      ProjectGroundedQuestionRequestSchema.safeParse({
        questionId: "00000000-0000-4000-8000-000000000327",
        question: localizedQuestion,
      }).success,
    ).toBe(true);
  });

  it("exposes accessible compare and common-theme actions with editable questions", () => {
    expect(ProjectConversationModeSchema.parse("compare_viewpoints")).toBe(
      "compare_viewpoints",
    );
    expect(ProjectConversationModeSchema.parse("common_themes")).toBe(
      "common_themes",
    );
    expect(PROJECT_GUIDED_ACTIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mode: "compare_viewpoints",
          label: "Compare viewpoints",
        }),
        expect.objectContaining({
          mode: "common_themes",
          label: "Find common themes",
        }),
      ]),
    );
    expect(getProjectGuidedAction("compare_viewpoints")?.question).toContain(
      "Compare",
    );
    expect(getProjectGuidedAction("common_themes")?.question).toContain(
      "common themes",
    );
  });

  it("exposes gap-finding and Project Assessment actions with trust boundaries", () => {
    expect(ProjectConversationModeSchema.parse("find_gaps")).toBe("find_gaps");
    expect(ProjectConversationModeSchema.parse("project_assessment")).toBe(
      "project_assessment",
    );
    expect(PROJECT_GUIDED_ACTIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mode: "find_gaps",
          label: "Find gaps and unexplored angles",
        }),
        expect.objectContaining({
          mode: "project_assessment",
          label: "Project Assessment",
        }),
      ]),
    );

    const gaps = buildProjectSynthesisInstructions("find_gaps");
    expect(gaps).toContain("missing perspectives");
    expect(gaps).toContain("Proposed questions and creative opportunities");
    expect(gaps).toContain("Source-supported observations");
    expect(gaps).toContain("counterarguments");

    const assessment = buildProjectSynthesisInstructions("project_assessment");
    expect(assessment).toContain("Project Assessment");
    expect(assessment).toContain("criteria");
    expect(assessment).toContain("calibrated confidence");
    expect(assessment).toContain("not externally verified truth");
    expect(assessment).toContain("ABSTAINED");

    expect(buildProjectSynthesisAbstention("find_gaps", "no_supported_gaps")).toContain(
      "identify gaps",
    );
    expect(
      buildProjectSynthesisAbstention("project_assessment", "insufficient_assessment"),
    ).toContain("Project Assessment");
  });

  it("requires source-by-source disagreement preservation and repeated-evidence rules", () => {
    const compare = buildProjectSynthesisInstructions("compare_viewpoints");
    expect(compare).toContain("source by source");
    expect(compare).toContain("disagreement");
    expect(compare).toContain("Do not average");
    expect(compare).toContain("[S1 @");

    const themes = buildProjectSynthesisInstructions("common_themes");
    expect(themes).toContain("at least two distinct sources");
    expect(themes).toContain("model interpretation");
    expect(themes).toContain("material disagreements");
    expect(themes).toContain("ABSTAINED");
  });

  it("keeps conflicting, repeated, and multilingual evidence source-identifiable", () => {
    const passages = [
      ...conflictingViewpointPassages(),
      ...repeatedThemePassages(),
      ...multilingualPassages(),
    ];
    const artifacts = buildProjectAnswerArtifacts({
      projectId: PROJECT_ID,
      goal: null,
      search: {
        status: "ready",
        sourceSetRevision: 4,
        coverage: {
          totalVideos: 3,
          readyVideos: 3,
          unavailableVideos: [],
          passagesExamined: passages.length,
        },
        passages,
      },
    });
    expect(artifacts.sourceManifest.sources.map((source) => source.sourceId)).toEqual([
      "S1",
      "S2",
      "S3",
    ]);
    const [primer] = buildProjectGroundedMessages({
      projectName: "Synthesis fixture",
      goal: null,
      question: "Compare viewpoints and find common themes",
      history: [],
      sourceManifest: artifacts.sourceManifest,
      evidenceSnapshot: artifacts.evidenceSnapshot,
      mode: "compare_viewpoints",
    });
    expect(primer.content).toContain("April because the team is ready");
    expect(primer.content).toContain("wait until June");
    expect(primer.content).toContain("La transparencia");
    expect(primer.content).toContain("透明なテスト");
    expect(primer.content).toContain("source by source");

    const [assessmentPrimer] = buildProjectGroundedMessages({
      projectName: "Synthesis fixture",
      goal: null,
      question: "Which position is better supported?",
      history: [],
      sourceManifest: artifacts.sourceManifest,
      evidenceSnapshot: artifacts.evidenceSnapshot,
      mode: "project_assessment",
    });
    expect(assessmentPrimer.content).toContain("April because the team is ready");
    expect(assessmentPrimer.content).toContain("wait until June");
    expect(assessmentPrimer.content).toContain("La transparencia");
    expect(assessmentPrimer.content).toContain("directness and relevance");
    expect(assessmentPrimer.content).toContain("not externally verified truth");
  });

  it("requires structured sections before guided synthesis can be persisted", () => {
    const findGaps = validateProjectSynthesisResponse(
      "find_gaps",
      "Source-supported observations\nThe sources omit a local perspective [S1 @ 00:42].\n\nProposed questions and creative opportunities\nWhat would a local study add? [S1 @ 00:42].",
    );
    expect(findGaps).toEqual({ valid: true });

    const assessment = validateProjectSynthesisResponse(
      "project_assessment",
      "Project Assessment\n\nCompeting positions\nApril is supported [S1 @ 00:42]. June is supported [S2 @ 00:44].\n\nCriteria\nDirectness, corroboration, and limitations weigh the positions.\n\nConfidence: medium",
    );
    expect(assessment).toEqual({ valid: true });

    expect(
      validateProjectSynthesisResponse(
        "find_gaps",
        "Source-supported observations\nOnly one section arrived.",
      ),
    ).toEqual({ valid: false, reason: "missing_proposals" });
    expect(
      validateProjectSynthesisResponse(
        "project_assessment",
        "Project Assessment\nApril seems better supported [S1 @ 00:42].",
      ),
    ).toEqual({ valid: false, reason: "missing_assessment_structure" });
  });

  it("keeps a genuine multilingual competing position in Assessment evidence and citations", () => {
    const passages = [
      passage({
        text: "The April AI launch is supported by direct evidence.",
        startSeconds: 42,
      }),
      passage({
        videoId: VIDEO_TWO_ID,
        youtubeVideoId: "bbbbbbb0002",
        title: "五月观点",
        channelName: "研究频道",
        text: "AI 发布应优先考虑本地证据，这代表相反的立场。",
        language: "zh",
        startSeconds: 44,
      }),
    ];
    const artifacts = buildProjectAnswerArtifacts({
      projectId: PROJECT_ID,
      goal: null,
      search: {
        status: "ready",
        sourceSetRevision: 4,
        coverage: {
          totalVideos: 2,
          readyVideos: 2,
          unavailableVideos: [],
          passagesExamined: passages.length,
        },
        passages,
      },
    });

    const [assessmentPrimer] = buildProjectGroundedMessages({
      projectName: "Multilingual assessment fixture",
      goal: null,
      question: "Which AI launch position is better supported?",
      history: [],
      sourceManifest: artifacts.sourceManifest,
      evidenceSnapshot: artifacts.evidenceSnapshot,
      mode: "project_assessment",
    });
    expect(assessmentPrimer.content).toContain(
      "AI 发布应优先考虑本地证据，这代表相反的立场。",
    );

    const inspection = inspectProjectCitations(
      "Project Assessment\n\nCompeting positions\nThe April position is supported [S1 @ 00:42]. AI 发布应优先考虑本地证据 [S2 @ 00:44].\n\nCriteria\nDirectness and relevance [S1 @ 00:42].\n\nConfidence: medium",
      artifacts.sourceManifest,
    );
    expect(inspection.validSourceIds).toEqual(["S1", "S2"]);
    expect(inspection.allClaimsCited).toBe(true);
  });
});
