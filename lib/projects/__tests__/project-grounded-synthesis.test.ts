import { describe, expect, it } from "vitest";
import {
  PROJECT_GUIDED_ACTIONS,
  ProjectConversationModeSchema,
  buildProjectSynthesisInstructions,
  getProjectGuidedAction,
} from "../project-grounded-synthesis";
import { buildProjectAnswerArtifacts } from "../project-grounded-evidence";
import { buildProjectGroundedMessages } from "../project-grounded-prompt";
import {
  PROJECT_ID,
  conflictingViewpointPassages,
  multilingualPassages,
  repeatedThemePassages,
} from "./project-grounded-test-fixtures";

describe("Project guided synthesis contract", () => {
  it("exposes accessible compare and common-theme actions with editable questions", () => {
    expect(ProjectConversationModeSchema.parse("compare_viewpoints")).toBe(
      "compare_viewpoints",
    );
    expect(ProjectConversationModeSchema.parse("common_themes")).toBe(
      "common_themes",
    );
    expect(PROJECT_GUIDED_ACTIONS).toEqual([
      expect.objectContaining({
        mode: "compare_viewpoints",
        label: "Compare viewpoints",
      }),
      expect.objectContaining({
        mode: "common_themes",
        label: "Find common themes",
      }),
    ]);
    expect(getProjectGuidedAction("compare_viewpoints")?.question).toContain(
      "Compare",
    );
    expect(getProjectGuidedAction("common_themes")?.question).toContain(
      "common themes",
    );
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
  });
});
