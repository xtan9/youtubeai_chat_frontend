// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../project-source-set", () => ({
  ProjectSourceSet: ({
    initialSourceSet,
    onSourceSetChange,
  }: {
    initialSourceSet: { revision: number };
    onSourceSetChange: (next: { revision: number; videos: never[]; projectId: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onSourceSetChange({
          projectId: "10000000-0000-4000-8000-000000000001",
          revision: initialSourceSet.revision + 1,
          videos: [],
        })
      }
    >
      Advance Source Set
    </button>
  ),
}));
vi.mock("../project-artifacts", () => ({
  ProjectArtifacts: ({ currentSourceSetRevision }: { currentSourceSetRevision: number }) => (
    <output aria-label="Artifact Source Set revision">
      {currentSourceSetRevision}
    </output>
  ),
}));
vi.mock("../project-conversation", () => ({ ProjectConversation: () => null }));
vi.mock("../project-search", () => ({ ProjectSearch: () => null }));

import { ProjectView } from "../project-view";

describe("ProjectView shared Source Set state", () => {
  it("propagates a same-page Source Set mutation to all Artifact kinds without reload", async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(
      <ProjectView
        initialProject={{
          id: "10000000-0000-4000-8000-000000000001",
          name: "Launch research",
          goal: null,
          lastActiveAt: "2026-08-09T00:00:00.000Z",
          createdAt: "2026-08-09T00:00:00.000Z",
          updatedAt: "2026-08-09T00:00:00.000Z",
        }}
        initialSourceSet={{
          projectId: "10000000-0000-4000-8000-000000000001",
          revision: 3,
          videos: [],
        }}
        initialCandidatePage={null}
        initialConversation={{
          conversationId: null,
          messages: [],
          nextCursor: null,
          messagesUsed: 0,
          messagesLimit: 5,
          tier: "free",
        }}
        initialConversations={[]}
        initialStudyGuide={{
          status: "ready",
          currentSourceSetRevision: 3,
          current: null,
          history: [],
          tier: "free",
          generationsUsed: 0,
          generationsLimit: 1,
        }}
        initialCreatorBrief={{
          status: "ready",
          currentSourceSetRevision: 3,
          current: null,
          history: [],
          tier: "free",
          generationsUsed: 0,
          generationsLimit: 1,
        }}
        initialProjectBrief={{
          status: "ready",
          currentSourceSetRevision: 3,
          current: null,
          history: [],
          tier: "free",
          generationsUsed: 0,
          generationsLimit: 1,
        }}
      />,
    );

    const privacyBoundary = container.querySelector(
      ".ph-no-capture[data-ph-no-autocapture]",
    );
    expect(privacyBoundary?.classList.contains("ph-no-capture")).toBe(true);
    expect(privacyBoundary?.hasAttribute("data-ph-no-autocapture")).toBe(true);
    expect(screen.getByLabelText("Artifact Source Set revision").textContent).toBe("3");
    await user.click(screen.getByRole("button", { name: "Advance Source Set" }));
    expect(screen.getByLabelText("Artifact Source Set revision").textContent).toBe("4");
  });

  it("blocks the Project-name delete confirmation in its Radix portal", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ProjectView
        initialProject={{
          id: "10000000-0000-4000-8000-000000000001",
          name: "Private launch research",
          goal: "Private Goal",
          lastActiveAt: "2026-08-09T00:00:00.000Z",
          createdAt: "2026-08-09T00:00:00.000Z",
          updatedAt: "2026-08-09T00:00:00.000Z",
        }}
        initialSourceSet={{
          projectId: "10000000-0000-4000-8000-000000000001",
          revision: 3,
          videos: [],
        }}
        initialCandidatePage={null}
        initialConversation={{
          conversationId: null,
          messages: [],
          nextCursor: null,
          messagesUsed: 0,
          messagesLimit: 5,
          tier: "free",
        }}
        initialConversations={[]}
        initialStudyGuide={{
          status: "ready",
          currentSourceSetRevision: 3,
          current: null,
          history: [],
          tier: "free",
          generationsUsed: 0,
          generationsLimit: 1,
        }}
        initialCreatorBrief={{
          status: "ready",
          currentSourceSetRevision: 3,
          current: null,
          history: [],
          tier: "free",
          generationsUsed: 0,
          generationsLimit: 1,
        }}
        initialProjectBrief={{
          status: "ready",
          currentSourceSetRevision: 3,
          current: null,
          history: [],
          tier: "free",
          generationsUsed: 0,
          generationsLimit: 1,
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete Project" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.classList.contains("ph-no-capture")).toBe(true);
    expect(dialog.hasAttribute("data-ph-no-autocapture")).toBe(true);
  });
});
