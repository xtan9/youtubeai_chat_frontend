// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";
import { AssistantAnswer } from "../project-conversation-messages";

const manifest = { projectId: "10000000-0000-4000-8000-000000000001", sourceSetRevision: 10, sources: [] };
const coverage = { totalVideos: 5, readyVideos: 5, usedVideos: 0, unavailableVideos: [], passagesExamined: 4895, passagesUsed: 0 };

describe("Research answer presentation", () => {
  it("distinguishes a retrieval miss from a claim verdict and retains inspectable coverage", async () => {
    const { container } = renderWithProviders(
      <AssistantAnswer
        content="I could not find relevant passages for this question."
        manifest={manifest}
        coverage={coverage}
        classification="unsupported"
        diagnostics={[]}
      />,
    );
    expect(screen.getByText("No matching passages")).toBeTruthy();
    expect(screen.queryByText("Unsupported by sources")).toBeNull();
    expect(screen.getByText(/does not establish whether the claim is true or false/)).toBeTruthy();
    expect(screen.getByLabelText("Answer coverage summary").textContent).toContain("0 of 5 videos used");
    const details = screen.getByText("View sources and retrieval details").closest("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByText("View sources and retrieval details"));
    expect(details.open).toBe(true);
    expect(screen.getByLabelText("Source Coverage").textContent).toContain("Passages examined4895");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("lets a researcher inspect the complete selected context and open its video timestamp", async () => {
    const quote = "We compare local measurements before drawing conclusions. " + "The surrounding transcript preserves qualifications and counterexamples. ".repeat(12);
    const { container } = renderWithProviders(
      <AssistantAnswer
        content="The conclusion depends on local measurements."
        manifest={manifest}
        coverage={{ ...coverage, passagesUsed: 1, usedVideos: 1 }}
        classification="supported"
        diagnostics={[]}
        evidenceSnapshot={{
          projectId: manifest.projectId,
          sourceSetRevision: 10,
          passages: [{
            passageId: `30000000-0000-4000-8000-000000000001:3-6:0:${quote.length}`,
            videoId: "30000000-0000-4000-8000-000000000001",
            youtubeVideoId: "aaaaaaa0001",
            title: "Local measurements",
            channelName: "Research channel",
            text: quote,
            segmentOrdinal: 3,
            endSegmentOrdinal: 6,
            excerptStartCharacter: 0,
            excerptEndCharacter: quote.length,
            startSeconds: 42,
            endSeconds: 95,
            language: "en",
            truncatedStart: false,
            truncatedEnd: false,
          }],
        }}
      />,
    );
    fireEvent.click(screen.getByText("View sources and retrieval details"));
    const passageSummary = screen.getByText("Passage 1 · Local measurements · [0:42]–[1:35]");
    expect(passageSummary.closest("details")!.open).toBe(false);
    fireEvent.click(passageSummary);
    expect(passageSummary.closest("details")!.open).toBe(true);
    expect(container.querySelector("blockquote")?.textContent).toBe(quote);
    expect(screen.getByRole("link", { name: "Watch Local measurements at [0:42]" }).getAttribute("href")).toBe("https://www.youtube.com/watch?v=aaaaaaa0001&t=42s");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("keeps unsupported evidence distinct when passages were actually retrieved", () => {
    renderWithProviders(
      <AssistantAnswer
        content="These passages do not support the requested claim."
        manifest={manifest}
        coverage={{ ...coverage, passagesUsed: 2, usedVideos: 1 }}
        classification="unsupported"
        diagnostics={[]}
      />,
    );
    expect(screen.getByText("Unsupported by sources")).toBeTruthy();
    expect(screen.queryByText("No matching passages")).toBeNull();
  });
});
