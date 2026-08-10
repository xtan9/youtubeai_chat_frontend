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
import { buildProjectBriefMarkdown } from "@/lib/projects/project-brief";
import { ProjectBrief } from "../project-brief";

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/analytics/client", () => ({ captureAnalyticsEvent: analytics.capture }));

const CONTENT = `# Project Brief

## Important findings

The launch happened in April [S1 @ 00:42].

## Agreements

The source consistently dates the launch to April [S1 @ 00:42].

## Material disagreements

The available source does not establish a cross-source conflict [S1 @ 00:42].

## Open questions

- What happened after launch [S1 @ 00:42]?`;

function artifact(
  revision = 3,
  overrides: Partial<ProjectArtifact> = {},
): ProjectArtifact {
  const evidence = buildProjectAnswerArtifacts({
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
  return {
    artifactId: `32000000-0000-4000-8000-00000000000${revision}`,
    projectId: PROJECT_ID,
    kind: "project_brief",
    content: CONTENT,
    sourceSetRevision: revision,
    sourceManifest: evidence.sourceManifest,
    sourceCoverage: evidence.sourceCoverage,
    evidenceSnapshot: evidence.evidenceSnapshot,
    citationDiagnostics: [],
    generationMetadata: {
      model: "gpt-5.3-codex-spark",
      promptVersion: "project-brief-v1",
      generatedAt: `2026-08-0${revision}T18:00:00.000Z`,
    },
    createdAt: `2026-08-0${revision}T18:00:00.000Z`,
    supersededAt: null,
    updateAvailable: false,
    ...overrides,
  };
}

function loaded(
  overrides: Partial<Extract<ProjectArtifactLoadResolution, { status: "ready" }>> = {},
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

describe("ProjectBrief", () => {
  beforeEach(() => analytics.capture.mockReset());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("generates from server-loaded state into an accessible cited brief", async () => {
    const current = artifact();
    const next = loaded({ current, generationsUsed: 1 });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ projectBrief: next }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = renderWithProviders(
      <ProjectBrief
        projectId={PROJECT_ID}
        projectName="Launch research"
        initialProjectBrief={loaded()}
      />,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Generate Project Brief" }));

    await screen.findByRole("heading", { name: "Material disagreements" });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/artifacts/project-brief`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(screen.getByRole("heading", { name: "Open questions" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /S1 @ 00:42.*Launch notes/i })[0]?.getAttribute("href"))
      .toBe("https://www.youtube.com/watch?v=aaaaaaa0001&t=42s");
    expect(screen.getByLabelText("Project Brief provenance").textContent).toContain("1 passage");
    expect(analytics.capture).toHaveBeenCalledWith(
      "project_artifact_generation_requested",
      { kind: "project_brief", tier: "free", is_regeneration: false },
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("keeps stale content and earlier provenance visible until explicit regeneration", async () => {
    const current = artifact(3, { updateAvailable: true });
    const prior = artifact(2, {
      artifactId: "32000000-0000-4000-8000-000000000009",
      supersededAt: "2026-08-03T18:00:00.000Z",
    });
    const { container } = renderWithProviders(
      <ProjectBrief
        projectId={PROJECT_ID}
        projectName="Launch research"
        currentSourceSetRevision={4}
        initialProjectBrief={loaded({
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
    expect(screen.getByRole("button", { name: "Regenerate Project Brief" })).toBeTruthy();
    fireEvent.click(screen.getByText("Earlier provenance (1)"));
    expect(within(screen.getByLabelText("Earlier Project Brief provenance")).getByText(/revision 2/)).toBeTruthy();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("copies and downloads only citation-safe Markdown", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:project-brief");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    let filename = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click(this: HTMLAnchorElement) {
      filename = this.download;
    });
    const unsafe = CONTENT.replace(
      "The launch happened in April [S1 @ 00:42].",
      "[Outside](https://evil.example) and [script](javascript:alert(1)) repeat April [S1 @ 00:42].",
    );
    const current = artifact(3, { content: unsafe });
    const expected = buildProjectBriefMarkdown(unsafe, current.sourceManifest);
    renderWithProviders(
      <ProjectBrief
        projectId={PROJECT_ID}
        projectName="Launch Research & Notes"
        initialProjectBrief={loaded({ current, generationsUsed: 1 })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Copy Markdown" }));
    expect(writeText).toHaveBeenCalledWith(expected);
    expect(expected).not.toContain("evil.example");
    expect(expected).not.toContain("javascript:");
    await user.click(screen.getByRole("button", { name: "Download Markdown" }));
    expect(filename).toBe("launch-research-notes-project-brief.md");
    expect(analytics.capture).toHaveBeenCalledWith(
      "project_artifact_exported",
      { kind: "project_brief", format: "markdown" },
    );
  });

  it("shows the shared Artifact upgrade path after an atomic 402", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        message: "Free includes 1 Artifact generation total.",
        upgradeUrl: "/pricing",
      }), { status: 402, headers: { "Content-Type": "application/json" } }),
    ));
    const user = userEvent.setup();
    renderWithProviders(
      <ProjectBrief projectId={PROJECT_ID} projectName="Launch research" initialProjectBrief={loaded()} />,
    );

    await user.click(screen.getByRole("button", { name: "Generate Project Brief" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Free includes 1 Artifact generation total.");
    expect(within(alert).getByRole("link", { name: "View Pro plans" }).getAttribute("href")).toBe("/pricing");
    expect(analytics.capture).toHaveBeenCalledWith(
      "project_artifact_generation_blocked",
      { kind: "project_brief", tier: "free", failure_category: "quota" },
    );
  });

  it("reflects a sibling Artifact consuming the shared Free allowance", () => {
    renderWithProviders(
      <ProjectBrief
        projectId={PROJECT_ID}
        projectName="Launch research"
        initialProjectBrief={loaded()}
        sharedGenerationsUsed={1}
        onGenerationsUsedChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Free Artifact generations: 1/1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generate Project Brief" })).toBeTruthy();
  });
});
