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
import { buildProjectStudyGuideMarkdown } from "@/lib/projects/project-study-guide";
import { ProjectStudyGuide } from "../project-study-guide";

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent: analytics.capture,
}));

const CONTENT = `# Study Guide

## Overview

The launch happened in April [S1 @ 00:42].

## Key ideas

- The source dates the launch to April [S1 @ 00:42].

## Review questions

1. When did the launch happen [S1 @ 00:42]?`;

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
    artifactId: `30000000-0000-4000-8000-00000000000${revision}`,
    projectId: PROJECT_ID,
    kind: "study_guide",
    content: CONTENT,
    sourceSetRevision: revision,
    sourceManifest: artifacts.sourceManifest,
    sourceCoverage: artifacts.sourceCoverage,
    evidenceSnapshot: artifacts.evidenceSnapshot,
    citationDiagnostics: [],
    generationMetadata: {
      model: "gpt-5.3-codex-spark",
      promptVersion: "study-guide-v1",
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

function jsonResponse(studyGuide: unknown, status = 200) {
  return new Response(JSON.stringify({ studyGuide }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ProjectStudyGuide", () => {
  beforeEach(() => {
    analytics.capture.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("generates into a grounded, accessible reading surface without a client GET", async () => {
    const current = artifact();
    const next = loaded({
      current,
      generationsUsed: 1,
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(next, 201));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = renderWithProviders(
      <ProjectStudyGuide
        projectId={PROJECT_ID}
        projectName="Launch research"
        initialStudyGuide={loaded()}
      />,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Generate Study Guide" }),
    );

    await screen.findByText(/The launch happened in April/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/artifacts/study-guide`,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const request = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as { attemptToken: string };
    expect(request.attemptToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    expect(
      screen
        .getAllByRole("link", { name: /S1 @ 00:42.*Launch notes/i })[0]
        ?.getAttribute("href"),
    ).toBe("https://www.youtube.com/watch?v=aaaaaaa0001&t=42s");
    await user.click(
      screen.getAllByRole("link", { name: /S1 @ 00:42.*Launch notes/i })[0]!,
    );
    expect(analytics.capture).toHaveBeenCalledWith(
      "project_citation_clicked",
      {
        project_id: PROJECT_ID,
        citation_context: "artifact",
        artifact_id: current.artifactId,
        artifact_kind: "study_guide",
        citation_ordinal: 1,
        source_ordinal: 1,
        timestamp_seconds: 42,
      },
    );
    expect(screen.getByLabelText("Study Guide provenance").textContent).toContain(
      "1 passage",
    );
    expect(analytics.capture).toHaveBeenCalledWith(
      "project_artifact_generation_requested",
      {
        project_id: PROJECT_ID,
        kind: "study_guide",
        tier: "free",
        is_regeneration: false,
      },
    );
    expect(analytics.capture).toHaveBeenCalledWith(
      "project_artifact_generation_completed",
      {
        project_id: PROJECT_ID,
        kind: "study_guide",
        tier: "free",
        source_set_revision: 3,
        evidence_videos: 1,
        evidence_passages: 1,
        generations_used: 1,
      },
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("keeps the current guide immutable when its Source Set has an update", async () => {
    const current = artifact(3, { updateAvailable: true });
    const prior = artifact(2, {
      artifactId: "30000000-0000-4000-8000-000000000009",
      supersededAt: "2026-08-03T18:00:00.000Z",
      updateAvailable: true,
    });
    const { container } = renderWithProviders(
      <ProjectStudyGuide
        projectId={PROJECT_ID}
        projectName="Launch research"
        currentSourceSetRevision={4}
        initialStudyGuide={loaded({
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
      screen.getByRole("button", { name: "Regenerate Study Guide" }),
    ).toBeTruthy();
    expect(screen.getByText(/The launch happened in April/)).toBeTruthy();
    const provenance = screen.getByLabelText("Study Guide provenance");
    expect(provenance.textContent).toContain("Source Set revision 3");
    expect(provenance.textContent).toContain("1 passage");

    fireEvent.click(
      screen.getByText("Earlier provenance (1)"),
    );
    const history = screen.getByLabelText("Earlier Study Guide provenance");
    expect(within(history).getByText(/Source Set revision 2/)).toBeTruthy();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("marks the current guide stale when the lifted Source Set revision advances", () => {
    const current = artifact(3);
    const { rerender } = renderWithProviders(
      <ProjectStudyGuide
        projectId={PROJECT_ID}
        projectName="Launch research"
        currentSourceSetRevision={3}
        initialStudyGuide={loaded({ current, generationsUsed: 1 })}
      />,
    );

    expect(screen.queryByText("Update available", { exact: true })).toBeNull();
    rerender(
      <ProjectStudyGuide
        projectId={PROJECT_ID}
        projectName="Launch research"
        currentSourceSetRevision={4}
        initialStudyGuide={loaded({ current, generationsUsed: 1 })}
      />,
    );

    expect(screen.getByText("Update available", { exact: true })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "The Source Set is now revision 4",
    );
  });

  it("copies and downloads citation-linked Markdown without changing structure", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:study-guide");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    let download: { href: string; filename: string } | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function click(this: HTMLAnchorElement) {
        download = { href: this.href, filename: this.download };
      },
    );
    const current = artifact();
    const expected = buildProjectStudyGuideMarkdown(
      CONTENT,
      current.sourceManifest,
    );
    renderWithProviders(
      <ProjectStudyGuide
        projectId={PROJECT_ID}
        projectName="Launch Research & Notes"
        initialStudyGuide={loaded({ current, generationsUsed: 1 })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Copy Markdown" }));
    expect(writeText).toHaveBeenCalledWith(expected);
    expect(await screen.findByText("Markdown copied.")).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Download Markdown" }),
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    if (!(blob instanceof Blob)) throw new TypeError("Expected Markdown Blob.");
    expect(await blob.text()).toBe(expected);
    expect(download).toEqual({
      href: "blob:study-guide",
      filename: "launch-research-notes-study-guide.md",
    });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:study-guide");
    expect(analytics.capture).toHaveBeenCalledWith(
      "project_artifact_exported",
      { project_id: PROJECT_ID, kind: "study_guide", format: "clipboard" },
    );
    expect(analytics.capture).toHaveBeenCalledWith(
      "project_artifact_exported",
      { project_id: PROJECT_ID, kind: "study_guide", format: "markdown" },
    );
  });

  it("renders and exports only canonical timestamp citations as active links", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const unsafeContent = CONTENT.replace(
      "The launch happened in April [S1 @ 00:42].",
      "[Untrusted link](javascript:alert(1)) and [outside source](https://evil.example/path) repeat the launch claim [S1 @ 00:42].",
    );
    const current = artifact(3, { content: unsafeContent });
    renderWithProviders(
      <ProjectStudyGuide
        projectId={PROJECT_ID}
        projectName="Launch research"
        initialStudyGuide={loaded({ current, generationsUsed: 1 })}
      />,
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links.every((link) => link.getAttribute("href")?.startsWith(
      "https://www.youtube.com/watch?v=aaaaaaa0001&t=42s",
    ))).toBe(true);
    expect(screen.getByText(/Untrusted link.*outside source/u)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Copy Markdown" }));
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).not.toContain("javascript:");
    expect(copied).not.toContain("evil.example");
    expect(copied).toContain(
      "[S1 @ 00:42](https://www.youtube.com/watch?v=aaaaaaa0001&t=42s)",
    );
  });

  it("keeps point and range citations interactive when they share one timestamp URL", () => {
    const mixedCitations = CONTENT.replace(
      "The source dates the launch to April [S1 @ 00:42].",
      "The source dates the launch to April [S1 @ 00:42-00:58].",
    );
    const current = artifact(3, { content: mixedCitations });
    renderWithProviders(
      <ProjectStudyGuide
        projectId={PROJECT_ID}
        projectName="Launch research"
        initialStudyGuide={loaded({ current, generationsUsed: 1 })}
      />,
    );

    const point = screen.getAllByRole("link", {
      name: /S1 @ 00:42, open Launch notes at this timestamp/i,
    });
    const range = screen.getByRole("link", {
      name: /S1 @ 00:42-00:58, open Launch notes at this timestamp/i,
    });
    expect(point).toHaveLength(2);
    expect(range.getAttribute("href")).toBe(
      "https://www.youtube.com/watch?v=aaaaaaa0001&t=42s",
    );
    expect(point.every((link) => link.getAttribute("href") === range.getAttribute("href"))).toBe(
      true,
    );
  });

  it("renders the Artifact-specific Free upgrade path after an atomic 402", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message:
            "Free includes 1 Artifact generation total. Upgrade to Pro for unlimited Artifact generations within technical and abuse limits.",
          errorCode: "free_artifact_generation_exceeded",
          tier: "free",
          upgradeUrl: "/pricing",
          artifactGenerationsUsed: 1,
          artifactGenerationsLimit: 1,
        }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = renderWithProviders(
      <ProjectStudyGuide
        projectId={PROJECT_ID}
        projectName="Launch research"
        initialStudyGuide={loaded()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Generate Study Guide" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Free includes 1 Artifact generation total.",
    );
    expect(
      within(alert).getByRole("link", { name: "View Pro plans" }).getAttribute(
        "href",
      ),
    ).toBe("/pricing");
    expect(analytics.capture).toHaveBeenCalledWith(
      "project_artifact_generation_blocked",
      {
        project_id: PROJECT_ID,
        kind: "study_guide",
        tier: "free",
        failure_category: "quota",
      },
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
