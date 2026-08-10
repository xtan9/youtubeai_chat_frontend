import { describe, expect, it } from "vitest";
import { buildProjectAnswerArtifacts } from "../project-grounded-evidence";
import {
  buildProjectCreatorBriefMarkdown,
  buildProjectCreatorBriefMessages,
  validateProjectCreatorBrief,
} from "../project-creator-brief";
import { PROJECT_ID, passage } from "./project-grounded-test-fixtures";

function artifacts() {
  return buildProjectAnswerArtifacts({
    projectId: PROJECT_ID,
    goal: "Plan an original Video about a trustworthy product launch.",
    search: {
      status: "ready",
      sourceSetRevision: 8,
      coverage: {
        totalVideos: 1,
        readyVideos: 1,
        unavailableVideos: [],
        passagesExamined: 4,
      },
      passages: [
        passage({
          text: "The team delayed the launch until testing could demonstrate reliability.",
        }),
      ],
    },
  });
}

const CONTENT = `# Creator Brief

## Source claims

- Inspiration: Team delayed launch testing reliability [S1 @ 00:42].

## Proposed ideas

- Gap: Evidence basis: reliability testing; Goal fit: trustworthy product launch; Original move: Show how unfinished reliability testing changes a trustworthy product launch decision [S1 @ 00:42].
- Combination: Evidence basis: delayed reliability; Goal fit: trustworthy product launch; Original move: Pair delayed reliability choices with a trustworthy product launch checklist [S1 @ 00:42].
- Counterargument: Evidence basis: testing reliability; Goal fit: trustworthy product launch; Original move: Ask when testing reliability makes a trustworthy product launch too cautious [S1 @ 00:42].
- Original angle: Evidence basis: reliability testing; Goal fit: trustworthy product launch; Original move: Make reliability testing visible inside each trustworthy product launch decision [S1 @ 00:42].

## Originality plan

- Source sequence: delay > evidence > demonstration [S1 @ 00:42].
- Proposed sequence: hook > evidence > framework.

## Video direction

- Proposed beat: Evidence basis: reliability testing; Goal fit: trustworthy product launch; Original move: Open with reliability testing, then build a decision framework for a trustworthy product launch [S1 @ 00:42].`;

describe("Project Creator Brief originality and grounding", () => {
  it("treats Project metadata as guidance and explicitly prohibits imitating source expression", () => {
    const evidence = artifacts();
    const messages = buildProjectCreatorBriefMessages({
      projectName: "Private Project",
      goal: "Plan an original Video about a trustworthy product launch.",
      sourceManifest: evidence.sourceManifest,
      evidenceSnapshot: evidence.evidenceSnapshot,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain("PROJECT_GOAL_GUIDANCE_NOT_EVIDENCE");
    expect(messages[0].content).toContain("EVIDENCE_SNAPSHOT");
    expect(messages[0].content).toContain(
      "The team delayed the launch until testing could demonstrate reliability.",
    );
    expect(messages[0].content).toContain("distinctive wording");
    expect(messages[0].content).toContain("structure");
    expect(messages[0].content).toContain("framing sequence");
    expect(messages[0].content).toContain("creator style");
    expect(messages[0].content).toContain(
      "clearly separate Source claims from Proposed ideas",
    );
    expect(messages[0].content).toContain(
      "Use exactly these headings in order: # Creator Brief, ## Source claims, ## Proposed ideas, ## Originality plan, ## Video direction.",
    );
    expect(messages[0].content).toContain(
      "Prefix the four Proposed ideas with - Gap:, - Combination:, - Counterargument:, and - Original angle:.",
    );
    expect(messages[0].content).toContain("Evidence basis:");
    expect(messages[0].content).toContain("Goal fit:");
    expect(messages[0].content).toContain("Original move:");
    expect(messages[0].content).toContain("Source sequence:");
    expect(messages[0].content).toContain("Proposed sequence:");
    expect(messages[0].content).toContain("generic creative mechanics");
    expect(messages[0].content).toContain("preserve the evidence order");
    expect(messages[0].content).toContain('never drop "not"');
    expect(messages[0].content).toContain(
      "exactly one canonical Timestamp Citation",
    );
    expect(messages[0].content).toContain(
      "a separate single-citation Source-claim line",
    );
    expect(messages[0].content).toContain("checklist");
    expect(messages[0].content).not.toContain("celebrity");
    expect(messages[0].content).toContain(
      "Represent every material source",
    );
  });

  it("accepts only the explicit Source-claim and Proposed-idea structure with supported inspirations", () => {
    const evidence = artifacts();

    expect(
      validateProjectCreatorBrief(
        CONTENT,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan an original Video about a trustworthy product launch.",
      ),
    ).toEqual({
      status: "valid",
      content: CONTENT,
      citationDiagnostics: [],
      validCitationCount: 7,
    });

    for (const terminalRangeCitation of [
      "[S1 @ 00:42-00:58]",
      "[S1 @ 00:42–00:58]",
    ]) {
      expect(
        validateProjectCreatorBrief(
          CONTENT.replace(
            "Team delayed launch testing reliability [S1 @ 00:42]",
            `Team delayed launch testing reliability ${terminalRangeCitation}`,
          ),
          evidence.sourceManifest,
          evidence.evidenceSnapshot,
          "Plan an original Video about a trustworthy product launch.",
        ),
      ).toEqual(expect.objectContaining({ status: "valid" }));
    }

    expect(
      validateProjectCreatorBrief(
        CONTENT.replace("- Gap:", "- Observation:"),
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan an original Video about a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "invalid", reason: "invalid_structure" });
    expect(
      validateProjectCreatorBrief(
        CONTENT.replace(
          "- Proposed sequence: hook > evidence > framework.",
          "- Proposed sequence: demonstration > evidence > delay.",
        ),
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan an original Video about a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "invalid", reason: "structure_similarity" });
    expect(
      validateProjectCreatorBrief(
        CONTENT.replaceAll("S1", "S9"),
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan an original Video about a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "invalid", reason: "invalid_citation" });
    expect(
      validateProjectCreatorBrief(
        CONTENT.replace(
          "Team delayed launch testing reliability [S1 @ 00:42]",
          "[S1 @ 00:42] Team delayed launch testing reliability",
        ),
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan an original Video about a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "invalid", reason: "invalid_structure" });

    expect(
      validateProjectCreatorBrief(
        CONTENT.replace(
          "Team delayed launch testing reliability",
          "Celebrity wardrobe drove launch publicity",
        ),
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan an original Video about a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "invalid", reason: "unsupported_inspiration" });

    expect(
      validateProjectCreatorBrief(
        CONTENT.replace(
          "Team delayed launch testing reliability",
          "Launch delayed reliability testing",
        ),
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan an original Video about a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "invalid", reason: "unsupported_inspiration" });

    expect(
      validateProjectCreatorBrief(
        CONTENT.replace(
          "Open with reliability testing, then build a decision framework for a trustworthy product launch",
          "Wrap reliability testing and a trustworthy product launch around a celebrity countdown",
        ),
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan an original Video about a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "invalid", reason: "unsupported_inspiration" });
  });

  it("preserves explicit Source-claim negation instead of dropping polarity", () => {
    const evidence = buildProjectAnswerArtifacts({
      projectId: PROJECT_ID,
      goal: "Plan an original Video about a trustworthy product launch.",
      search: {
        status: "ready",
        sourceSetRevision: 8,
        coverage: {
          totalVideos: 1,
          readyVideos: 1,
          unavailableVideos: [],
          passagesExamined: 2,
        },
        passages: [
          passage({
            text: "The team delayed the launch because testing did not demonstrate reliability.",
          }),
        ],
      },
    });
    const supported = CONTENT.replace(
      "Team delayed launch testing reliability",
      "Testing not demonstrate reliability",
    );

    expect(
      validateProjectCreatorBrief(
        supported,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan an original Video about a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "valid" });
    expect(
      validateProjectCreatorBrief(
        supported.replace(
          "Testing not demonstrate reliability",
          "Testing demonstrate reliability",
        ),
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan an original Video about a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "invalid", reason: "unsupported_inspiration" });
    expect(
      validateProjectCreatorBrief(
        CONTENT.replace(
          "Team delayed launch testing reliability",
          "Team not delayed launch testing reliability",
        ),
        artifacts().sourceManifest,
        artifacts().evidenceSnapshot,
        "Plan an original Video about a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "invalid", reason: "unsupported_inspiration" });

    const leadingEvidence = buildProjectAnswerArtifacts({
      projectId: PROJECT_ID,
      goal: "Plan an original Video about a trustworthy product launch.",
      search: {
        status: "ready",
        sourceSetRevision: 8,
        coverage: {
          totalVideos: 1,
          readyVideos: 1,
          unavailableVideos: [],
          passagesExamined: 2,
        },
        passages: [
          passage({
            text: "Not after several attempts, the team delayed launch until testing demonstrated reliability.",
          }),
        ],
      },
    });
    const leadingSupported = CONTENT.replace(
      "Team delayed launch testing reliability",
      "Not delayed launch testing reliability",
    );
    expect(
      validateProjectCreatorBrief(
        leadingSupported,
        leadingEvidence.sourceManifest,
        leadingEvidence.evidenceSnapshot,
        "Plan an original Video about a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "valid" });
    expect(
      validateProjectCreatorBrief(
        leadingSupported.replace(
          "Not delayed launch testing reliability",
          "Delayed launch testing reliability",
        ),
        leadingEvidence.sourceManifest,
        leadingEvidence.evidenceSnapshot,
        "Plan an original Video about a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "invalid", reason: "unsupported_inspiration" });

    const trailingEvidence = buildProjectAnswerArtifacts({
      projectId: PROJECT_ID,
      goal: "Plan an original Video about a trustworthy product launch.",
      search: {
        status: "ready",
        sourceSetRevision: 8,
        coverage: {
          totalVideos: 1,
          readyVideos: 1,
          unavailableVideos: [],
          passagesExamined: 2,
        },
        passages: [
          passage({
            text: "The team delayed launch until testing demonstrated reliability, which it did not.",
          }),
        ],
      },
    });
    const trailingSupported = CONTENT.replace(
      "Team delayed launch testing reliability",
      "Delayed launch testing reliability not",
    );
    expect(
      validateProjectCreatorBrief(
        trailingSupported,
        trailingEvidence.sourceManifest,
        trailingEvidence.evidenceSnapshot,
        "Plan an original Video about a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "valid" });
    expect(
      validateProjectCreatorBrief(
        trailingSupported.replace(
          "Delayed launch testing reliability not",
          "Delayed launch testing reliability",
        ),
        trailingEvidence.sourceManifest,
        trailingEvidence.evidenceSnapshot,
        "Plan an original Video about a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "invalid", reason: "unsupported_inspiration" });
  });

  it("attributes mixed polarity to separate single-citation Source claims", () => {
    const evidence = buildProjectAnswerArtifacts({
      projectId: PROJECT_ID,
      goal: "Plan a trustworthy product launch.",
      balanceSources: true,
      search: {
        status: "ready",
        sourceSetRevision: 8,
        coverage: {
          totalVideos: 2,
          readyVideos: 2,
          unavailableVideos: [],
          passagesExamined: 4,
        },
        passages: [
          passage({
            text: "The team delayed the launch until testing could demonstrate reliability.",
          }),
          passage({
            videoId: "20000000-0000-4000-8000-000000000002",
            youtubeVideoId: "bbbbbbb0002",
            title: "Customer notes",
            text: "Customer interviews expected to confirm readiness, but did not.",
            startSeconds: 84,
            endSeconds: 96,
          }),
        ],
      },
    });
    const supported = `# Creator Brief

## Source claims

- Inspiration: Team delayed launch testing reliability [S1 @ 00:42].
- Inspiration: Customer interviews readiness not [S2 @ 01:24].

## Proposed ideas

- Gap: Evidence basis: reliability testing and customer interviews; Goal fit: trustworthy product launch; Original move: Explore reliability testing with customer interviews for a trustworthy product launch [S1 @ 00:42] [S2 @ 01:24].
- Combination: Evidence basis: reliability testing and customer interviews; Goal fit: trustworthy product launch; Original move: Pair reliability testing with customer interviews for a trustworthy product launch [S1 @ 00:42] [S2 @ 01:24].
- Counterargument: Evidence basis: reliability testing and customer readiness; Goal fit: trustworthy product launch; Original move: Ask whether reliability testing can resolve customer readiness for a trustworthy product launch [S1 @ 00:42] [S2 @ 01:24].
- Original angle: Evidence basis: reliability testing and customer interviews; Goal fit: trustworthy product launch; Original move: Make reliability testing and customer interviews a dialogue for a trustworthy product launch [S1 @ 00:42] [S2 @ 01:24].

## Originality plan

- Source sequence: delay > evidence > interview [S1 @ 00:42] [S2 @ 01:24].
- Proposed sequence: contrast > evidence > framework.

## Video direction

- Proposed beat: Evidence basis: reliability testing and customer interviews; Goal fit: trustworthy product launch; Original move: Contrast reliability testing and customer interviews, then build a framework for a trustworthy product launch [S1 @ 00:42] [S2 @ 01:24].`;

    expect(
      validateProjectCreatorBrief(
        supported,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "valid" });
    expect(
      validateProjectCreatorBrief(
        supported.replace(
          "- Inspiration: Team delayed launch testing reliability [S1 @ 00:42].\n- Inspiration: Customer interviews readiness not [S2 @ 01:24].",
          "- Inspiration: Team delayed launch testing reliability customer interviews readiness not [S1 @ 00:42] [S2 @ 01:24].",
        ),
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "invalid", reason: "invalid_structure" });
  });

  it("accepts a Goal-relevant original adaptation brief without mistaking shared topic words for imitation", () => {
    const evidence = buildProjectAnswerArtifacts({
      projectId: PROJECT_ID,
      goal: "Explore local climate adaptation decisions.",
      search: {
        status: "ready",
        sourceSetRevision: 8,
        coverage: {
          totalVideos: 1,
          readyVideos: 1,
          unavailableVideos: [],
          passagesExamined: 2,
        },
        passages: [
          passage({
            text: "Climate adaptation depends on exact local evidence.",
            endSeconds: 48,
          }),
        ],
      },
    });
    const adaptationBrief = `# Creator Brief

## Source claims

- Inspiration: Climate adaptation exact local evidence [S1 @ 00:42].

## Proposed ideas

- Gap: Evidence basis: exact evidence; Goal fit: local climate adaptation; Original move: Show which local climate adaptation choices still lack exact evidence [S1 @ 00:42].
- Combination: Evidence basis: exact evidence; Goal fit: local climate adaptation; Original move: Pair local climate adaptation choices with exact evidence checks [S1 @ 00:42-00:48].
- Counterargument: Evidence basis: exact evidence; Goal fit: local climate adaptation; Original move: Ask when exact evidence gives local climate adaptation false certainty [S1 @ 00:42].
- Original angle: Evidence basis: exact evidence; Goal fit: local climate adaptation; Original move: Make exact evidence revisable within local climate adaptation choices [S1 @ 00:42].

## Originality plan

- Source sequence: evidence > context > decision [S1 @ 00:42].
- Proposed sequence: hook > evidence > framework.

## Video direction

- Proposed beat: Evidence basis: exact evidence; Goal fit: local climate adaptation; Original move: Open with exact evidence, then map a decision framework for local climate adaptation [S1 @ 00:42].`;

    expect(
      validateProjectCreatorBrief(
        adaptationBrief,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Explore local climate adaptation decisions.",
      ),
    ).toEqual(expect.objectContaining({ status: "valid" }));

    const twoSourceEvidence = buildProjectAnswerArtifacts({
      projectId: PROJECT_ID,
      goal: "Explore local climate adaptation decisions.",
      balanceSources: true,
      search: {
        status: "ready",
        sourceSetRevision: 9,
        coverage: {
          totalVideos: 2,
          readyVideos: 2,
          unavailableVideos: [],
          passagesExamined: 4,
        },
        passages: [
          passage({
            text: "Climate adaptation depends on exact local evidence.",
            endSeconds: 48,
          }),
          passage({
            videoId: "20000000-0000-4000-8000-000000000002",
            youtubeVideoId: "bbbbbbb0002",
            title: "Beta processing",
            text: "Regional field interviews reveal conflicting adaptation priorities.",
            endSeconds: 48,
          }),
        ],
      },
    });
    const twoSourceBrief = `# Creator Brief

## Source claims

- Inspiration: Climate adaptation exact local evidence [S1 @ 00:42].
- Inspiration: Regional interviews conflicting adaptation priorities [S2 @ 00:42].

## Proposed ideas

- Gap: Evidence basis: exact evidence; Goal fit: local climate adaptation; Original move: Show which local climate adaptation choices still lack exact evidence [S1 @ 00:42].
- Combination: Evidence basis: exact evidence and regional interviews; Goal fit: local climate adaptation; Original move: Compare exact evidence with regional interviews for local climate adaptation choices [S1 @ 00:42-00:48] [S2 @ 00:42-00:48].
- Counterargument: Evidence basis: exact evidence; Goal fit: local climate adaptation; Original move: Ask when exact evidence gives local climate adaptation false certainty [S1 @ 00:42].
- Original angle: Evidence basis: regional interviews; Goal fit: local climate adaptation; Original move: Map regional interviews into revisable local climate adaptation choices [S2 @ 00:42].

## Originality plan

- Source sequence: evidence > contrast > decision [S1 @ 00:42] [S2 @ 00:42].
- Proposed sequence: contrast > evidence > framework.

## Video direction

- Proposed beat: Evidence basis: exact evidence and regional interviews; Goal fit: local climate adaptation; Original move: Contrast exact evidence and regional interviews, then map a decision framework for local climate adaptation [S1 @ 00:42] [S2 @ 00:42].`;
    expect(
      validateProjectCreatorBrief(
        twoSourceBrief,
        twoSourceEvidence.sourceManifest,
        twoSourceEvidence.evidenceSnapshot,
        "Explore local climate adaptation decisions.",
      ),
    ).toEqual(expect.objectContaining({ status: "valid" }));
  });

  it("rejects source expression copied into an otherwise cited brief", () => {
    const evidence = artifacts();
    const copied = CONTENT.replace(
      "Team delayed launch testing reliability",
      "The team delayed the launch until testing could demonstrate reliability",
    );

    expect(
      validateProjectCreatorBrief(
        copied,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan an original Video about a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "invalid", reason: "source_similarity" });

    const copiedIntoIdea = CONTENT.replace(
      "Make reliability testing visible inside each trustworthy product launch decision",
      "THE TEAM—DELAYED THE LAUNCH, UNTIL TESTING COULD DEMONSTRATE RELIABILITY",
    );
    expect(
      validateProjectCreatorBrief(
        copiedIntoIdea,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan an original Video about a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "invalid", reason: "source_similarity" });

    const shorterCopy = CONTENT.replace(
      "Show how unfinished reliability testing changes a trustworthy product launch decision",
      "Explore why teams delayed the launch until testing while planning the product",
    );
    expect(
      validateProjectCreatorBrief(
        shorterCopy,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan an original Video about a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "invalid", reason: "source_similarity" });

    const reorderedFraming = CONTENT.replace(
      "Pair delayed reliability choices with a trustworthy product launch checklist",
      "For the product launch, ask how reliability testing could demonstrate why the team delayed",
    );
    expect(
      validateProjectCreatorBrief(
        reorderedFraming,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan an original Video about a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "invalid", reason: "source_similarity" });
  });

  it("rejects cited proposed ideas that are irrelevant to the Goal or unsupported by their inspiration", () => {
    const evidence = artifacts();
    const goal = "Plan an original Video about a trustworthy product launch.";
    const goalIrrelevant = CONTENT.replace(
      "Goal fit: trustworthy product launch; Original move: Show how unfinished reliability testing changes a trustworthy product launch decision",
      "Goal fit: cooking tutorial recipe; Original move: Show how reliability testing changes a cooking tutorial recipe",
    );
    expect(
      validateProjectCreatorBrief(
        goalIrrelevant,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        goal,
      ),
    ).toMatchObject({ status: "invalid", reason: "goal_irrelevant" });

    const unsupported = CONTENT.replace(
      "Show how unfinished reliability testing changes a trustworthy product launch decision",
      "Build a playful celebrity countdown for the trustworthy product launch",
    );
    expect(
      validateProjectCreatorBrief(
        unsupported,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        goal,
      ),
    ).toMatchObject({ status: "invalid", reason: "unsupported_inspiration" });

    const laundered = CONTENT.replace(
      "Show how unfinished reliability testing changes a trustworthy product launch decision",
      "Build a reliability-themed celebrity countdown and costume reveal for the product launch",
    );
    expect(
      validateProjectCreatorBrief(
        laundered,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        goal,
      ),
    ).toMatchObject({ status: "invalid", reason: "unsupported_inspiration" });

    const traceLabelLaundering = CONTENT.replace(
      "Evidence basis: reliability testing; Goal fit: trustworthy product launch; Original move: Show how unfinished reliability testing changes a trustworthy product launch decision",
      "Evidence basis: reliability testing celebrity costume; Goal fit: trustworthy product launch celebrity countdown; Original move: Stage a celebrity costume countdown for a trustworthy product launch",
    );
    expect(
      validateProjectCreatorBrief(
        traceLabelLaundering,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        goal,
      ),
    ).toMatchObject({ status: "invalid", reason: "unsupported_inspiration" });

    const goalLabelLaundering = CONTENT.replace(
      "Evidence basis: reliability testing; Goal fit: trustworthy product launch; Original move: Show how unfinished reliability testing changes a trustworthy product launch decision",
      "Evidence basis: reliability testing; Goal fit: trustworthy product launch celebrity countdown; Original move: Make reliability testing drive a celebrity countdown",
    );
    expect(
      validateProjectCreatorBrief(
        goalLabelLaundering,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        goal,
      ),
    ).toMatchObject({ status: "invalid", reason: "unsupported_inspiration" });

    const combinedLaundering = CONTENT.replace(
      "Show how unfinished reliability testing changes a trustworthy product launch decision",
      "Wrap reliability testing and a trustworthy product launch around a celebrity costume countdown",
    );
    expect(
      validateProjectCreatorBrief(
        combinedLaundering,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        goal,
      ),
    ).toMatchObject({ status: "invalid", reason: "unsupported_inspiration" });
  });

  it("rejects a paraphrased copy of the source narrative sequence", () => {
    const evidence = buildProjectAnswerArtifacts({
      projectId: PROJECT_ID,
      goal: "Plan a trustworthy product launch Video.",
      search: {
        status: "ready",
        sourceSetRevision: 8,
        coverage: {
          totalVideos: 1,
          readyVideos: 1,
          unavailableVideos: [],
          passagesExamined: 2,
        },
        passages: [
          passage({
            text: "Open on a ticking clock, show reliability tests failing, then return to the clock.",
          }),
        ],
      },
    });
    const copiedFraming = `# Creator Brief

## Source claims

- Inspiration: The sequence surrounds failed reliability tests with a clock [S1 @ 00:42].

## Proposed ideas

- Gap: Explore what product launch reliability tests leave unresolved [S1 @ 00:42].
- Combination: Pair a product launch clock with a reliability test question [S1 @ 00:42].
- Counterargument: Ask whether failed tests should always delay a product launch [S1 @ 00:42].
- Original angle: Make product launch reliability visible through a decision trail [S1 @ 00:42].

## Video direction

- Proposed beat: Begin with a countdown, move through failures, and finish on the countdown [S1 @ 00:42].`;

    expect(
      validateProjectCreatorBrief(
        copiedFraming,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan a trustworthy product launch Video.",
      ),
    ).toMatchObject({ status: "invalid", reason: "structure_similarity" });
  });

  it("requires every material Video and every multi-Video combination to be represented", () => {
    const evidence = buildProjectAnswerArtifacts({
      projectId: PROJECT_ID,
      goal: "Plan a trustworthy product launch.",
      search: {
        status: "ready",
        sourceSetRevision: 8,
        coverage: {
          totalVideos: 2,
          readyVideos: 2,
          unavailableVideos: [],
          passagesExamined: 8,
        },
        passages: [
          passage({
            text: "Reliability testing delayed the product launch.",
          }),
          passage({
            videoId: "20000000-0000-4000-8000-000000000002",
            youtubeVideoId: "bbbbbbb0002",
            title: "Customer notes",
            text: "Customer interviews revealed confusion about readiness.",
            startSeconds: 84,
            endSeconds: 96,
          }),
        ],
      },
    });
    const multiSource = `# Creator Brief

## Source claims

- Inspiration: Reliability testing delayed launch [S1 @ 00:42].
- Inspiration: Customer interviews confusion readiness [S2 @ 01:24].

## Proposed ideas

- Gap: Evidence basis: reliability testing and customer confusion; Goal fit: trustworthy product launch; Original move: Explore reliability testing that resolves customer confusion for a trustworthy product launch [S1 @ 00:42] [S2 @ 01:24].
- Combination: Evidence basis: reliability testing and customer interviews; Goal fit: trustworthy product launch; Original move: Pair reliability testing with customer interviews for a trustworthy product launch [S1 @ 00:42] [S2 @ 01:24].
- Counterargument: Evidence basis: reliability testing and customer confusion; Goal fit: trustworthy product launch; Original move: Ask whether reliability testing can eliminate customer confusion in a trustworthy product launch [S1 @ 00:42] [S2 @ 01:24].
- Original angle: Evidence basis: reliability testing and customer interviews; Goal fit: trustworthy product launch; Original move: Make reliability testing and customer interviews a dialogue for a trustworthy product launch [S1 @ 00:42] [S2 @ 01:24].

## Originality plan

- Source sequence: evidence > delay > interview [S1 @ 00:42] [S2 @ 01:24].
- Proposed sequence: contrast > evidence > framework.

## Video direction

- Proposed beat: Evidence basis: reliability testing and customer interviews; Goal fit: trustworthy product launch; Original move: Contrast reliability testing and customer interviews, then build a framework for a trustworthy product launch [S1 @ 00:42] [S2 @ 01:24].`;

    expect(
      validateProjectCreatorBrief(
        multiSource,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "valid" });
    const combinedSourceClaim = multiSource.replace(
      "- Inspiration: Reliability testing delayed launch [S1 @ 00:42].\n- Inspiration: Customer interviews confusion readiness [S2 @ 01:24].",
      "- Inspiration: Reliability testing delayed launch customer interviews confusion readiness [S1 @ 00:42] [S2 @ 01:24].",
    );
    expect(
      validateProjectCreatorBrief(
        combinedSourceClaim,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan a trustworthy product launch.",
      ),
    ).toMatchObject({ status: "invalid", reason: "invalid_structure" });
    expect(
      validateProjectCreatorBrief(
        combinedSourceClaim.replace(
          "customer interviews confusion readiness",
          "readiness confusion customer interviews",
        ),
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan a trustworthy product launch.",
      ),
    ).toMatchObject({
      status: "invalid",
      reason: "invalid_structure",
    });
    expect(
      validateProjectCreatorBrief(
        multiSource.replaceAll(" [S2 @ 01:24]", ""),
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan a trustworthy product launch.",
      ),
    ).toMatchObject({
      status: "invalid",
      reason: "missing_source_representation",
    });
    expect(
      validateProjectCreatorBrief(
        multiSource.replace(
          "- Inspiration: Customer interviews confusion readiness [S2 @ 01:24].\n",
          "",
        ),
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
        "Plan a trustworthy product launch.",
      ),
    ).toMatchObject({
      status: "invalid",
      reason: "missing_source_representation",
    });
  });

  it("exports only canonical timestamp links and strips model-authored targets", () => {
    const evidence = artifacts();
    const unsafe = CONTENT.replace(
      "Frame trust",
      "[Frame trust](javascript:alert(1)) near https://evil.example/research",
    );

    const markdown = buildProjectCreatorBriefMarkdown(
      unsafe,
      evidence.sourceManifest,
    );

    expect(markdown).toContain(
      "[S1 @ 00:42](https://www.youtube.com/watch?v=aaaaaaa0001&t=42s)",
    );
    expect(markdown).not.toContain("javascript:");
    expect(markdown).not.toContain("evil.example");
  });
});
