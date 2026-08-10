// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";
import type {
  ProjectArtifact,
  ProjectArtifactLoadResolution,
} from "@/lib/projects/project-artifact-contract";
import { buildProjectAnswerArtifacts } from "@/lib/projects/project-grounded-evidence";
import {
  PROJECT_ID,
  passage,
} from "@/lib/projects/__tests__/project-grounded-test-fixtures";
import { buildProjectCreatorBriefMarkdown } from "@/lib/projects/project-creator-brief";
import { ProjectCreatorBrief } from "../project-creator-brief";

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent: analytics.capture,
}));

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
- Proposed sequence: hook > decision > framework.

## Video direction

- Proposed beat: Evidence basis: reliability testing; Goal fit: trustworthy product launch; Original move: Open with reliability testing, then build a decision framework for a trustworthy product launch [S1 @ 00:42].`;

function evidence(revision = 3) {
  return buildProjectAnswerArtifacts({
    projectId: PROJECT_ID,
    goal: null,
    search: {
      status: "ready",
      sourceSetRevision: revision,
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

function artifact(
  revision = 3,
  overrides: Partial<ProjectArtifact> = {},
): ProjectArtifact {
  const artifacts = evidence(revision);
  return {
    artifactId: `40000000-0000-4000-8000-00000000000${revision}`,
    projectId: PROJECT_ID,
    kind: "creator_brief",
    content: CONTENT,
    sourceSetRevision: revision,
    sourceManifest: artifacts.sourceManifest,
    sourceCoverage: artifacts.sourceCoverage,
    evidenceSnapshot: artifacts.evidenceSnapshot,
    citationDiagnostics: [],
    generationMetadata: {
      model: "gpt-5.3-codex-spark",
      promptVersion: "creator-brief-v1",
      generatedAt: `2026-08-0${revision}T18:00:00.000Z`,
    },
    createdAt: `2026-08-0${revision}T18:00:00.000Z`,
    supersededAt: null,
    updateAvailable: false,
    ...overrides,
  };
}

function loaded(
  overrides: Partial<
    Extract<ProjectArtifactLoadResolution, { status: "ready" }>
  > = {},
): Extract<ProjectArtifactLoadResolution, { status: "ready" }> {
  return {
    status: "ready",
    currentSourceSetRevision: 3,
    current: null,
    history: [],
    tier: "free",
    generationsUsed: 0,
    generationsLimit: 1,
    ...overrides,
  };
}

describe("ProjectCreatorBrief", () => {
  beforeEach(() => analytics.capture.mockReset());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("generates an accessible brief that visibly separates source claims from proposed ideas", async () => {
    const next = loaded({ current: artifact(), generationsUsed: 1 });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ creatorBrief: next }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = renderWithProviders(
      <ProjectCreatorBrief
        projectId={PROJECT_ID}
        projectName="Launch research"
        initialCreatorBrief={loaded()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Generate Creator Brief" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Source claims" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Proposed ideas" })).toBeTruthy();
    expect(screen.getByText(/Original angle:/u)).toBeTruthy();
    expect(screen.getByLabelText("Creator Brief provenance").textContent).toContain(
      "1 passage",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/artifacts/creator-brief`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(analytics.capture).toHaveBeenCalledWith(
      "project_artifact_generation_completed",
      expect.objectContaining({ kind: "creator_brief", generations_used: 1 }),
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("preserves current and earlier provenance when the Source Set makes the brief stale", () => {
    const current = artifact(3);
    const prior = artifact(2, {
      artifactId: "40000000-0000-4000-8000-000000000009",
      supersededAt: "2026-08-03T18:00:00.000Z",
      updateAvailable: true,
    });
    renderWithProviders(
      <ProjectCreatorBrief
        projectId={PROJECT_ID}
        projectName="Launch research"
        currentSourceSetRevision={4}
        initialCreatorBrief={loaded({
          currentSourceSetRevision: 4,
          current,
          history: [prior],
          tier: "pro",
          generationsUsed: 2,
          generationsLimit: null,
        })}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("Update available");
    expect(
      screen.getByRole("button", { name: "Regenerate Creator Brief" }),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("Creator Brief provenance").textContent,
    ).toContain("Source Set revision 3");
    fireEvent.click(screen.getByText("Earlier provenance (1)"));
    expect(
      within(screen.getByLabelText("Earlier Creator Brief provenance")).getByText(
        /Source Set revision 2/u,
      ),
    ).toBeTruthy();
  });

  it("copies and downloads citation-linked Creator Brief Markdown", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:creator-brief");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    let filename = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function click(this: HTMLAnchorElement) {
        filename = this.download;
      },
    );
    const current = artifact();
    const expected = buildProjectCreatorBriefMarkdown(
      CONTENT,
      current.sourceManifest,
    );
    renderWithProviders(
      <ProjectCreatorBrief
        projectId={PROJECT_ID}
        projectName="Launch Research & Notes"
        initialCreatorBrief={loaded({ current, generationsUsed: 1 })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Copy Markdown" }));
    expect(writeText).toHaveBeenCalledWith(expected);
    await user.click(screen.getByRole("button", { name: "Download Markdown" }));
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    if (!(blob instanceof Blob)) throw new TypeError("Expected Markdown Blob.");
    expect(await blob.text()).toBe(expected);
    expect(filename).toBe("launch-research-notes-creator-brief.md");
    expect(analytics.capture).toHaveBeenCalledWith(
      "project_artifact_exported",
      { kind: "creator_brief", format: "clipboard" },
    );
    expect(analytics.capture).toHaveBeenCalledWith(
      "project_artifact_exported",
      { kind: "creator_brief", format: "markdown" },
    );
  });
});
