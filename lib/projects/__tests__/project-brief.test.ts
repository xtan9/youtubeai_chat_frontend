import { describe, expect, it } from "vitest";
import { buildProjectAnswerArtifacts } from "../project-grounded-evidence";
import {
  buildProjectBriefMarkdown,
  buildProjectBriefMessages,
  validateProjectBrief,
} from "../project-brief";
import {
  conflictingViewpointPassages,
  passage,
  PROJECT_ID,
  repeatedThemePassages,
} from "./project-grounded-test-fixtures";

function artifacts() {
  return buildProjectAnswerArtifacts({
    projectId: PROJECT_ID,
    goal: "Choose an April launch, but never treat this as evidence.",
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

const CONTENT = `# Project Brief

## Important findings

- One source supports an April launch because the team is ready [S1 @ 00:12].

## Agreements

- Both sources connect trust to transparent testing [S1 @ 00:24] [S2 @ 00:31].

## Material disagreements

- Position A: The launch should happen in April because the team is ready [S1 @ 00:12].
- Position B: The launch should wait until June because testing is incomplete [S2 @ 00:18].

## Open questions

- Which launch timing is better supported after testing finishes [S1 @ 00:12] [S2 @ 00:18]?`;

describe("Project Brief grounding and export", () => {
  it("treats Project metadata as guidance and preserves agreements, disagreements, and open questions as distinct sections", () => {
    const evidence = artifacts();
    const messages = buildProjectBriefMessages({
      projectName: "Private launch research",
      goal: "Choose an April launch, but never treat this as evidence.",
      sourceManifest: evidence.sourceManifest,
      evidenceSnapshot: evidence.evidenceSnapshot,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain("PROJECT_GOAL_GUIDANCE_NOT_EVIDENCE");
    expect(messages[0].content).toContain("EVIDENCE_SNAPSHOT");
    expect(messages[0].content).toContain("## Important findings");
    expect(messages[0].content).toContain("## Agreements");
    expect(messages[0].content).toContain("## Material disagreements");
    expect(messages[0].content).toContain("## Open questions");
    expect(messages[0].content).toContain("Do not merge competing positions");
    expect(messages[0].content).toContain("- Position A:");
    expect(messages[0].content).toContain("- Position B:");
  });

  it("accepts only a complete brief whose factual lines use valid source-aware citations", () => {
    const evidence = artifacts();

    expect(
      validateProjectBrief(
        CONTENT,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
      ),
    ).toEqual({
      status: "valid",
      content: CONTENT,
      citationDiagnostics: [],
      validCitationCount: 7,
    });

    expect(
      validateProjectBrief(
        CONTENT.replace("## Open questions", "## Next steps"),
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
      ),
    ).toMatchObject({ status: "invalid", reason: "invalid_structure" });
    expect(
      validateProjectBrief(
        CONTENT.replace(" [S1 @ 00:12].", "."),
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
      ),
    ).toMatchObject({ status: "invalid", reason: "uncited_claim" });
    expect(
      validateProjectBrief(
        CONTENT.replaceAll("S2", "S9"),
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
      ),
    ).toMatchObject({ status: "invalid", reason: "invalid_citation" });
  });

  it("requires cross-source support for agreements and keeps competing positions source-distinct", () => {
    const evidence = artifacts();
    const singleSourceAgreement = CONTENT.replace(
      " [S1 @ 00:24] [S2 @ 00:31].",
      " [S1 @ 00:24].",
    );
    const singleSourceDisagreement = CONTENT.replace(
      "The launch should wait until June because testing is incomplete [S2 @ 00:18]",
      "The launch should happen in April because the team is ready [S1 @ 00:12]",
    );

    expect(
      validateProjectBrief(
        singleSourceAgreement,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
      ),
    ).toMatchObject({ status: "invalid", reason: "false_consensus" });
    expect(
      validateProjectBrief(
        singleSourceDisagreement,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
      ),
    ).toMatchObject({ status: "invalid", reason: "collapsed_disagreement" });
  });

  it("requires two independently supported positions and rejects cited collapsed or fabricated disagreement", () => {
    const evidence = artifacts();
    const collapsed = CONTENT.replace(
      "- Position A: The launch should happen in April because the team is ready [S1 @ 00:12].\n- Position B: The launch should wait until June because testing is incomplete [S2 @ 00:18].",
      "- Both sources support a careful launch after testing [S1 @ 00:12] [S2 @ 00:18].",
    );
    const fabricated = CONTENT.replace(
      "The launch should wait until June because testing is incomplete [S2 @ 00:18]",
      "The April launch is ready and fully tested [S2 @ 00:18]",
    );

    expect(
      validateProjectBrief(
        collapsed,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
      ),
    ).toMatchObject({ status: "invalid", reason: "collapsed_disagreement" });
    expect(
      validateProjectBrief(
        fabricated,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
      ),
    ).toMatchObject({ status: "invalid", reason: "collapsed_disagreement" });
  });

  it("rejects agreement and disagreement omission sentinels when the immutable snapshot supports those sections", () => {
    const evidence = artifacts();
    const omittedAgreement = CONTENT.replace(
      "- Both sources connect trust to transparent testing [S1 @ 00:24] [S2 @ 00:31].",
      "- No supported cross-source agreement in this Evidence Snapshot.",
    );
    const omittedDisagreement = CONTENT.replace(
      "- Position A: The launch should happen in April because the team is ready [S1 @ 00:12].\n- Position B: The launch should wait until June because testing is incomplete [S2 @ 00:18].",
      "- No supported material disagreement in this Evidence Snapshot.",
    );

    expect(
      validateProjectBrief(
        omittedAgreement,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
      ),
    ).toMatchObject({ status: "invalid", reason: "false_consensus" });
    expect(
      validateProjectBrief(
        omittedDisagreement,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
      ),
    ).toMatchObject({ status: "invalid", reason: "collapsed_disagreement" });
  });

  it("supports a useful one-source brief without inventing agreement or disagreement", () => {
    const evidence = buildProjectAnswerArtifacts({
      projectId: PROJECT_ID,
      goal: null,
      search: {
        status: "ready",
        sourceSetRevision: 1,
        coverage: {
          totalVideos: 1,
          readyVideos: 1,
          unavailableVideos: [],
          passagesExamined: 1,
        },
        passages: [passage()],
      },
    });
    const oneSource = `# Project Brief

## Important findings

- Climate adaptation depends on exact local evidence [S1 @ 00:42].

## Agreements

- No supported cross-source agreement in this Evidence Snapshot.

## Material disagreements

- No supported material disagreement in this Evidence Snapshot.

## Open questions

- Which local evidence is still missing [S1 @ 00:42]?`;

    expect(
      validateProjectBrief(
        oneSource,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
      ),
    ).toMatchObject({ status: "valid" });
  });

  it("preserves a truthful multilingual conflict as two independently cited positions", () => {
    const evidence = buildProjectAnswerArtifacts({
      projectId: PROJECT_ID,
      goal: "Compare local and regional climate evidence.",
      search: {
        status: "ready",
        sourceSetRevision: 2,
        coverage: {
          totalVideos: 2,
          readyVideos: 2,
          unavailableVideos: [],
          passagesExamined: 2,
        },
        passages: [
          passage({ text: "Climate adaptation depends on exact local evidence." }),
          passage({
            videoId: "20000000-0000-4000-8000-000000000002",
            youtubeVideoId: "bbbbbbb0002",
            title: "Regional comparison",
            text: "气候适应不应依赖单一的本地证据，而应优先考虑区域比较。",
            language: "zh-Hans",
          }),
        ],
      },
    });
    const multilingual = `# Project Brief

## Important findings

- Exact local evidence informs climate adaptation [S1 @ 00:42].

## Agreements

- No supported cross-source agreement in this Evidence Snapshot.

## Material disagreements

- Position A: Climate adaptation depends on exact local evidence [S1 @ 00:42].
- Position B: 气候适应不应依赖单一的本地证据，而应优先考虑区域比较 [S2 @ 00:42].

## Open questions

- Which evidence approach should guide climate adaptation [S1 @ 00:42] [S2 @ 00:42]?`;

    expect(
      validateProjectBrief(
        multilingual,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
      ),
    ).toMatchObject({ status: "valid" });
  });

  it("keeps both omission sentinels valid when unrelated sources support neither relation", () => {
    const evidence = buildProjectAnswerArtifacts({
      projectId: PROJECT_ID,
      goal: null,
      search: {
        status: "ready",
        sourceSetRevision: 2,
        coverage: {
          totalVideos: 2,
          readyVideos: 2,
          unavailableVideos: [],
          passagesExamined: 2,
        },
        passages: [
          passage({ text: "Ocean salinity measurements vary by sensor." }),
          passage({
            videoId: "20000000-0000-4000-8000-000000000002",
            youtubeVideoId: "bbbbbbb0002",
            title: "River archive",
            text: "Historical archives record river flooding dates.",
          }),
        ],
      },
    });
    const unrelated = `# Project Brief

## Important findings

- Ocean salinity measurements vary by sensor [S1 @ 00:42].
- Historical archives record river flooding dates [S2 @ 00:42].

## Agreements

- No supported cross-source agreement in this Evidence Snapshot.

## Material disagreements

- No supported material disagreement in this Evidence Snapshot.

## Open questions

- Which evidence should be investigated next [S1 @ 00:42] [S2 @ 00:42]?`;

    expect(
      validateProjectBrief(
        unrelated,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
      ),
    ).toMatchObject({ status: "valid" });
  });

  it("keeps open questions visibly unresolved and cites every material Evidence Snapshot source", () => {
    const evidence = artifacts();
    expect(
      validateProjectBrief(
        CONTENT.replace("?", "."),
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
      ),
    ).toMatchObject({ status: "invalid", reason: "settled_open_question" });
    expect(
      validateProjectBrief(
        CONTENT.replaceAll("[S2 @ 00:18]", "[S1 @ 00:12]").replaceAll(
          "[S2 @ 00:31]",
          "[S1 @ 00:24]",
        ),
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
      ),
    ).toMatchObject({ status: "invalid", reason: "missing_material_source" });
  });

  it("removes arbitrary model-authored links while preserving canonical citation links in Markdown export", () => {
    const evidence = artifacts();
    const linked = CONTENT.replace(
      "One source supports an April launch",
      "[One source](javascript:alert(1)) supports an April launch from https://evil.example/research",
    );
    const validated = validateProjectBrief(
      linked,
      evidence.sourceManifest,
      evidence.evidenceSnapshot,
    );

    expect(validated).toMatchObject({ status: "valid" });
    if (validated.status !== "valid") throw new Error("expected valid brief");
    expect(validated.content).not.toContain("javascript:");
    expect(validated.content).not.toContain("evil.example");

    const markdown = buildProjectBriefMarkdown(linked, evidence.sourceManifest);
    expect(markdown).not.toContain("javascript:");
    expect(markdown).not.toContain("evil.example");
    expect(markdown).toContain(
      "[S2 @ 00:18](https://www.youtube.com/watch?v=bbbbbbb0002&t=18s)",
    );
  });

  it("rejects valid citations that contradict the cited evidence or frame a settled claim as an open question", () => {
    const evidence = artifacts();
    const falseAgreement = CONTENT.replace(
      "Both sources connect trust to transparent testing",
      "Both sources agree that April is the settled best launch date",
    );
    const settledQuestion = CONTENT.replace(
      "Which launch timing is better supported after testing finishes",
      "April is conclusively best; what minor detail remains",
    );

    expect(
      validateProjectBrief(
        falseAgreement,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
      ),
    ).toMatchObject({ status: "invalid", reason: "false_consensus" });
    expect(
      validateProjectBrief(
        settledQuestion,
        evidence.sourceManifest,
        evidence.evidenceSnapshot,
      ),
    ).toMatchObject({ status: "invalid", reason: "settled_open_question" });
  });
});
