import { z } from "zod";

/**
 * The mode is deliberately small and server-owned. `question` is the normal
 * Project Conversation path; guided modes only change the synthesis
 * instructions and never change retrieval, quota, or persistence boundaries.
 */
export const ProjectConversationModeSchema = z.enum([
  "question",
  "compare_viewpoints",
  "common_themes",
  "find_gaps",
  "project_assessment",
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
  {
    mode: "find_gaps",
    label: "Find gaps and unexplored angles",
    description:
      "Identify missing perspectives, useful combinations, counterarguments, and questions grounded in the Project.",
    question:
      "Find gaps, missing perspectives, counterarguments, and unexplored angles across the Project Videos. Separate supported observations from proposed questions, and cite every supported claim.",
  },
  {
    mode: "project_assessment",
    label: "Project Assessment",
    description:
      "Weigh competing positions with explicit criteria and calibrated confidence inside this Project.",
    question:
      "Which position is better supported? Give a Project Assessment with explicit criteria, cite each material position, state calibrated confidence, and abstain when this Project cannot resolve it.",
  },
] as const;

export function getProjectGuidedAction(
  mode: ProjectConversationMode,
) {
  return PROJECT_GUIDED_ACTIONS.find((action) => action.mode === mode);
}

export type ProjectSynthesisValidation =
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly reason:
        | "missing_observations"
        | "missing_proposals"
        | "empty_section"
        | "missing_assessment_structure";
    };

const STRUCTURED_SYNTHESIS_HEADINGS = [
  "Source-supported observations",
  "Proposed questions and creative opportunities",
  "Project Assessment",
  "Competing positions",
  "Criteria",
] as const;

function normalizedHeading(line: string) {
  return line
    .trim()
    .replace(/^#{1,6}\s*/u, "")
    .replace(/:$/u, "")
    .trim()
    .toLocaleLowerCase();
}

function sectionBody(content: string, heading: string) {
  const lines = content.split(/\r?\n/u);
  const headingIndex = lines.findIndex(
    (line) => normalizedHeading(line) === heading.toLocaleLowerCase(),
  );
  if (headingIndex < 0) return null;
  const nextHeadingIndex = lines.findIndex(
    (line, index) =>
      index > headingIndex &&
      STRUCTURED_SYNTHESIS_HEADINGS.some(
        (candidate) => normalizedHeading(line) === candidate.toLocaleLowerCase(),
      ),
  );
  return lines
    .slice(headingIndex + 1, nextHeadingIndex < 0 ? lines.length : nextHeadingIndex)
    .join("\n")
    .trim();
}

/**
 * Guided modes use a small presentation contract so a model cannot silently
 * collapse source observations, proposals, and adjudication into one prose
 * blob before the durable completion write.
 */
export function validateProjectSynthesisResponse(
  mode: ProjectConversationMode,
  content: string,
): ProjectSynthesisValidation {
  if (mode === "find_gaps") {
    const observations = sectionBody(content, "Source-supported observations");
    if (observations === null) {
      return { valid: false, reason: "missing_observations" };
    }
    const proposals = sectionBody(
      content,
      "Proposed questions and creative opportunities",
    );
    if (proposals === null) {
      return { valid: false, reason: "missing_proposals" };
    }
    if (!observations || !proposals) {
      return { valid: false, reason: "empty_section" };
    }
    return { valid: true };
  }
  if (mode === "project_assessment") {
    const firstVisibleLine = content
      .split(/\r?\n/u)
      .find((line) => line.trim().length > 0);
    const positions = sectionBody(content, "Competing positions");
    const criteria = sectionBody(content, "Criteria");
    if (
      !firstVisibleLine ||
      normalizedHeading(firstVisibleLine) !== "project assessment" ||
      !positions ||
      !criteria ||
      !/\bconfidence\s*:\s*(?:high|medium|low)\b/iu.test(content)
    ) {
      return { valid: false, reason: "missing_assessment_structure" };
    }
    return { valid: true };
  }
  return { valid: true };
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
    case "find_gaps":
      return `GUIDED_SYNTHESIS_MODE: FIND_GAPS
- Begin with the exact heading "Source-supported observations", then use the exact heading "Proposed questions and creative opportunities". Keep both sections non-empty.
- Identify gaps, missing perspectives, useful combinations, counterarguments, and unexplored angles only from the retrieved Project evidence.
- Keep a "Source-supported observations" section separate from "Proposed questions and creative opportunities". Proposals are not source claims, must be labelled as proposals, and must not be presented as established facts.
- Explain which evidence is missing or underrepresented before suggesting a gap. Do not infer a source's position from silence, and preserve material disagreements.
- Cite every factual sentence with a valid source-and-timestamp citation. Use [S1 @ 00:42] or [S1 @ 00:42-00:58] only when that exact timestamp is present in EVIDENCE_SNAPSHOT.
- If the evidence cannot support a useful gap or unexplored angle, output ABSTAINED on the first line and let the application name the evidence gap.`;
    case "project_assessment":
      return `GUIDED_SYNTHESIS_MODE: PROJECT_ASSESSMENT
- Immediately after the SUPPORTED control line, output one hidden line beginning ASSESSMENT_EVIDENCE followed by one strict JSON object. For each material position include positionId, sourceId, one shared issueKey, supports/opposes relation, canonical citation, the exact Unicode passage text as exactQuote, and integer supportWeight from 1 to 5. Include a candidate with every position's exact relation/citation and one winnerPositionId. This line is validated against EVIDENCE_SNAPSHOT and removed before display. If competing positions have equal strongest support, output ABSTAINED instead of selecting a winner.
- Begin the visible answer with the exact heading "Project Assessment", then use the exact headings "Competing positions" and "Criteria". End the assessment with an explicit "Confidence: high", "Confidence: medium", or "Confidence: low" line. Make clear that this is a judgment of support within this Project, not externally verified truth.
- Identify every material competing position represented in EVIDENCE_SNAPSHOT, then explain the criteria used to weigh them: directness and relevance of the passages, corroboration across distinct Videos, and important limitations or missing evidence.
- Cite each material competing position and every factual sentence with valid source-and-timestamp citations. Do not erase disagreements or infer a position from silence.
- State calibrated confidence as high, medium, or low and explain why. If the Project evidence cannot resolve which position is better supported, output ABSTAINED on the first line and let the application provide the safe Project Assessment abstention.
- Use [S1 @ 00:42] or [S1 @ 00:42-00:58] only when that exact timestamp is present in EVIDENCE_SNAPSHOT.`;
    case "question":
      return "GUIDED_SYNTHESIS_MODE: QUESTION\n- Answer the current question directly using the normal grounded-answer citation and abstention rules.";
  }
}

export function buildProjectSynthesisAbstention(
  mode: ProjectConversationMode,
  reason:
    | "no_ready_evidence"
    | "no_repeated_theme"
    | "insufficient_comparison"
    | "no_supported_gaps"
    | "insufficient_assessment",
): string {
  if (reason === "no_ready_evidence") {
    return mode === "compare_viewpoints"
      ? "There is no ready Transcript evidence to compare across the Project Videos."
      : mode === "common_themes"
        ? "There is no ready Transcript evidence from which to identify a common theme."
        : mode === "find_gaps"
          ? "There is no ready Transcript evidence from which to identify a supported gap or unexplored angle."
          : mode === "project_assessment"
            ? "There is no ready Transcript evidence from which to provide a Project Assessment."
        : "This Project has no ready Transcript evidence yet, so I can't answer from its Project Videos.";
  }
  if (reason === "no_repeated_theme") {
    return "The retrieved Evidence Snapshot does not contain repeated support from at least two Project Videos, so I can't identify a common theme without guessing.";
  }
  if (reason === "no_supported_gaps") {
    return "The retrieved Evidence Snapshot does not support a useful gap or unexplored angle, so I can't identify gaps without guessing.";
  }
  if (reason === "insufficient_comparison") {
    return "The retrieved Evidence Snapshot does not support a source-by-source comparison, so I can't characterize the viewpoints without guessing.";
  }
  if (reason === "insufficient_assessment") {
    return "The Project evidence cannot resolve which position is better supported, so I can't provide a Project Assessment without guessing.";
  }
  return "The Evidence Snapshot does not support a confident answer to this question.";
}
