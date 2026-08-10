// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";
import type { ProjectArtifactLoadResolution } from "@/lib/projects/project-artifact-contract";
import { buildProjectAnswerArtifacts } from "@/lib/projects/project-grounded-evidence";
import {
  PROJECT_ID,
  passage,
} from "@/lib/projects/__tests__/project-grounded-test-fixtures";
import { ProjectArtifacts } from "../project-artifacts";

vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent: vi.fn(),
}));

const CREATOR_CONTENT = `# Creator Brief

## Source claims

- Inspiration: Team delayed launch testing reliability [S1 @ 00:42].

## Proposed ideas

- Gap: Evidence basis: reliability testing; Goal fit: trustworthy product launch; Original move: Show how unfinished reliability testing changes a trustworthy product launch decision [S1 @ 00:42].
- Combination: Evidence basis: delayed reliability; Goal fit: trustworthy product launch; Original move: Pair delayed reliability choices with a trustworthy product launch checklist [S1 @ 00:42].
- Counterargument: Evidence basis: testing reliability; Goal fit: trustworthy product launch; Original move: Ask when testing reliability makes a trustworthy product launch too cautious [S1 @ 00:42].
- Original angle: Evidence basis: reliability testing; Goal fit: trustworthy product launch; Original move: Make reliability testing visible inside each trustworthy product launch decision [S1 @ 00:42].

## Originality plan

- Source sequence: delay > evidence > demonstration [S1 @ 00:42].
- Proposed sequence: hook > decision > framework.

## Video direction

- Proposed beat: Evidence basis: reliability testing; Goal fit: trustworthy product launch; Original move: Open with reliability testing, then build a decision framework for a trustworthy product launch [S1 @ 00:42].`;

function emptyLoad(): Extract<
  ProjectArtifactLoadResolution,
  { status: "ready" }
> {
  return {
    status: "ready",
    currentSourceSetRevision: 3,
    current: null,
    history: [],
    tier: "free",
    generationsUsed: 0,
    generationsLimit: 1,
  };
}

function generatedCreator(): Extract<
  ProjectArtifactLoadResolution,
  { status: "ready" }
> {
  const evidence = buildProjectAnswerArtifacts({
    projectId: PROJECT_ID,
    goal: null,
    search: {
      status: "ready",
      sourceSetRevision: 3,
      coverage: {
        totalVideos: 1,
        readyVideos: 1,
        unavailableVideos: [],
        passagesExamined: 4,
      },
      passages: [passage()],
    },
  });
  return {
    ...emptyLoad(),
    generationsUsed: 1,
    current: {
      artifactId: "40000000-0000-4000-8000-000000000003",
      projectId: PROJECT_ID,
      kind: "creator_brief",
      content: CREATOR_CONTENT,
      sourceSetRevision: 3,
      sourceManifest: evidence.sourceManifest,
      sourceCoverage: evidence.sourceCoverage,
      evidenceSnapshot: evidence.evidenceSnapshot,
      citationDiagnostics: [],
      generationMetadata: {
        model: "gpt-5.3-codex-spark",
        promptVersion: "creator-brief-v1",
        generatedAt: "2026-08-09T18:00:00.000Z",
      },
      createdAt: "2026-08-09T18:00:00.000Z",
      supersededAt: null,
      updateAvailable: false,
    },
  };
}

describe("ProjectArtifacts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lets Free choose Creator Brief first and shares the consumed allowance with Study Guide immediately", async () => {
    const creator = generatedCreator();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ creatorBrief: creator }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithProviders(
      <ProjectArtifacts
        projectId={PROJECT_ID}
        projectName="Launch research"
        currentSourceSetRevision={3}
        initialStudyGuide={emptyLoad()}
        initialCreatorBrief={emptyLoad()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Choose Creator Brief" }));
    expect(
      screen.getByRole("button", { name: "Generate Creator Brief" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Generate Creator Brief" }));
    expect(await screen.findByText("Creator Brief generated.")).toBeTruthy();
    expect(
      within(
        screen.getByRole("button", { name: "Choose Creator Brief" }),
      ).getByText("Current"),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Creator Brief" })).getByText(
        "Free Artifact generations: 1/1",
      ),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Choose Study Guide" }));
    expect(
      within(screen.getByRole("region", { name: "Study Guide" })).getByText(
        "Free Artifact generations: 1/1",
      ),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
