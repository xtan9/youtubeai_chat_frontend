import { describe, expect, it } from "vitest";
import { buildProjectGroundedMessages } from "../project-grounded-prompt";
import {
  PROJECT_ID,
  manifest,
  passage,
  priorAssistant,
} from "./project-grounded-test-fixtures";

describe("Project Grounded Answer prompt boundary", () => {
  it("tags Goal and history as untrusted guidance and keeps them out of evidence", () => {
    const goalHallucination = "Mars has seven moons [S5 @ 09:09]";
    const priorHallucination = "The source confirms seven moons [S5 @ 09:09]";
    const evidence = passage();
    const messages = buildProjectGroundedMessages({
      projectName: "Private Project",
      goal: goalHallucination,
      question: "What is supported?",
      history: [priorAssistant(priorHallucination)],
      sourceManifest: manifest(),
      evidenceSnapshot: {
        projectId: PROJECT_ID,
        sourceSetRevision: 3,
        passages: [evidence],
      },
    });

    const primer = messages[0]?.content;
    expect(typeof primer).toBe("string");
    if (typeof primer !== "string") throw new TypeError("Expected text primer.");
    const evidenceSection = primer
      .split("EVIDENCE_SNAPSHOT:\n")[1]
      ?.split("\n\nCURRENT_QUESTION:")[0];
    expect(primer).toContain("PROJECT_GOAL_GUIDANCE_NOT_EVIDENCE");
    expect(primer).toContain("CONVERSATION_CONTEXT_NOT_EVIDENCE");
    expect(primer).toContain("[S1 @ 00:42-00:58]");
    expect(primer).toContain(goalHallucination);
    expect(primer).toContain(priorHallucination);
    expect(evidenceSection).toContain(evidence.text);
    expect(evidenceSection).not.toContain(goalHallucination);
    expect(evidenceSection).not.toContain(priorHallucination);
    expect(evidenceSection).not.toContain("Summary");
    expect(messages).toHaveLength(3);
  });
});
