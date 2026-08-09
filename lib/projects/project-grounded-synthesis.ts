import { z } from "zod";

/**
 * The mode is deliberately small and server-owned. `question` is the normal
 * Project Conversation path; the two guided modes only change the synthesis
 * instructions and never change retrieval, quota, or persistence boundaries.
 */
export const ProjectConversationModeSchema = z.enum([
  "question",
  "compare_viewpoints",
  "common_themes",
]);

export type ProjectConversationMode = z.infer<
  typeof ProjectConversationModeSchema
>;

export const PROJECT_DEFAULT_CONVERSATION_MODE: ProjectConversationMode =
  "question";

export type ProjectGuidedAction = Readonly<{
  mode: Exclude<ProjectConversationMode, "question">;
  label: string;
  description: string;
  question: string;
}>;

/**
 * Keep these actions as plain data so the Project Conversation can render
 * keyboard/screen-reader friendly buttons without duplicating prompt copy.
 */
export const PROJECT_GUIDED_ACTIONS: readonly ProjectGuidedAction[] = [
  {
    mode: "compare_viewpoints",
    label: "Compare viewpoints",
    description:
      "Show where each Project Video agrees, disagrees, or leaves an evidence gap.",
    question:
      "Compare the viewpoints across the Project Videos. Identify agreements and material disagreements source by source, and cite every supported claim.",
  },
  {
    mode: "common_themes",
    label: "Find common themes",
    description:
      "Find ideas repeated by more than one source without inventing consensus.",
    question:
      "Find common themes repeated across the Project Videos. Separate repeated evidence from your interpretation, preserve material disagreements, and cite every supported claim.",
  },
] as const;

export function getProjectGuidedAction(
  mode: Exclude<ProjectConversationMode, "question">,
) {
  return PROJECT_GUIDED_ACTIONS.find((action) => action.mode === mode);
}

/**
 * Instructions are appended to the existing grounded prompt. They constrain
 * presentation and abstention while keeping EVIDENCE_SNAPSHOT as the only
 * factual source. The model still has to use the normal source/timestamp
 * citation syntax validated by the stream.
 */
export function buildProjectSynthesisInstructions(
  mode: ProjectConversationMode,
): string {
  switch (mode) {
    case "compare_viewpoints":
      return `GUIDED_SYNTHESIS_MODE: COMPARE_VIEWPOINTS
- Compare the evidence source by source. Name each source with its stable label (S1, S2, and so on) and attach a valid source-and-timestamp citation to every factual claim.
- Keep agreements and disagreements in separate sections. Preserve a material disagreement even when one position sounds more plausible. Do not average, merge, or manufacture consensus.
- Do not infer a source's position from silence. If the retrieved passages do not support a source-by-source comparison, output ABSTAINED on the first line and let the application explain the evidence gap.
- A supported comparison must include at least one citation for each source or explicitly state which source lacks evidence. Use [S1 @ 00:42] or [S1 @ 00:42-00:58] only when that exact timestamp is present in EVIDENCE_SNAPSHOT.`;
    case "common_themes":
      return `GUIDED_SYNTHESIS_MODE: COMMON_THEMES
- Call an idea a common theme only when repeated evidence supports it in at least two distinct sources. Cite the supporting source and timestamp for every factual sentence.
- Keep a short "Repeated evidence" section distinct from a "model interpretation" section. Model interpretation is a bounded inference, not a source claim, and must be labelled as such and cited to the evidence it interprets.
- Preserve material disagreements in a separate section; never turn disagreement into a common theme or false consensus.
- If no theme is supported by at least two sources, or the evidence is too thin to distinguish repetition from interpretation, output ABSTAINED on the first line and let the application name the evidence gap.
- Use [S1 @ 00:42] or [S1 @ 00:42-00:58] only when that exact timestamp is present in EVIDENCE_SNAPSHOT.`;
    case "question":
      return "GUIDED_SYNTHESIS_MODE: QUESTION\n- Answer the current question directly using the normal grounded-answer citation and abstention rules.";
  }
}

export function buildProjectSynthesisAbstention(
  mode: ProjectConversationMode,
  reason: "no_ready_evidence" | "no_repeated_theme" | "insufficient_comparison",
): string {
  if (reason === "no_ready_evidence") {
    return mode === "compare_viewpoints"
      ? "There is no ready Transcript evidence to compare across the Project Videos."
      : mode === "common_themes"
        ? "There is no ready Transcript evidence from which to identify a common theme."
        : "This Project has no ready Transcript evidence yet, so I can't answer from its Project Videos.";
  }
  if (reason === "no_repeated_theme") {
    return "The retrieved Evidence Snapshot does not contain repeated support from at least two Project Videos, so I can't identify a common theme without guessing.";
  }
  if (reason === "insufficient_comparison") {
    return "The retrieved Evidence Snapshot does not support a source-by-source comparison, so I can't characterize the viewpoints without guessing.";
  }
  return "The Evidence Snapshot does not support a confident answer to this question.";
}
