import { expect, it } from "vitest";
import type {
  ResearchDocument,
  ResearchVersion,
} from "@/lib/projects/project-research-contract";
import { groupClaimSpaces, claimSourceLink } from "../claim-spaces";
import type { Resource } from "../contract";

const origin = {
  id: "video",
  title: "Video",
  location: "00:18",
  quote: "A shared passage.",
};
const resource: Resource = {
  id: origin.id,
  title: origin.title,
  kind: "video",
  coverage: "",
  pages: [],
  url: "https://www.youtube.com/watch?v=example",
  digest: {
    summary: "",
    claims: ["First interpretation", "Second interpretation"].map(
      (text, i) => ({
        id: "c-" + i,
        text,
        quote: origin.quote,
        location: origin.location,
        seconds: 18,
      }),
    ),
  },
};
const observation = { text: "Judgment", references: [] };
function version(
  id: string,
  question: string,
  space?: ResearchDocument["space"],
): ResearchVersion {
  return {
    id,
    created_at: "2026-11-19",
    document: {
      question,
      space,
      evidence: [],
      searches: [],
      warnings: [],
      sourceSetRevision: 0,
      promptVersion: "project-research-v1",
      synthesis: {
        judgment: observation,
        findings: [],
        reasoning: observation,
        uncertainties: [],
        nextSteps: [],
        changes: "",
      },
    },
  };
}

it("keeps claims at a shared passage distinct and reopens a legacy follow-up by its parent", () => {
  const first = version("initial", "Second interpretation", { origin });
  const followup = version("followup", "How certain is that?", {
    origin,
    followUpTo: first.id,
  });
  const unknown = version("ambiguous", "Another question", { origin });
  const result = groupClaimSpaces(
    [resource],
    [],
    [unknown, followup, first],
    [
      {
        id: "retry",
        question: "Try again",
        message: "Failed",
        created: "2026-11-19",
        parent: followup.id,
      },
    ],
  );
  expect(result.rooms.get("c-0")?.versions).toHaveLength(0);
  const claim = result.rooms.get("c-1")!;
  expect(claim.versions).toEqual([first, followup]);
  expect(claim.attempts.map((attempt) => attempt.id)).toEqual(["retry"]);
  expect(result.byFinding.get(unknown.id)?.id).toBe("run-ambiguous");
  expect(claimSourceLink(claim)).toBe(resource.url + "&t=18s");
});

it("retains standalone project questions and a claim title when the original material is missing", () => {
  const manual = version("manual", "An independent question");
  const retained = version("retained", "Is that still true?", {
    claimId: "saved",
    claimTitle: "Original claim",
  });
  const { rooms, byFinding } = groupClaimSpaces(
    [],
    undefined,
    [retained, manual],
    undefined,
  );
  expect(rooms.get("run-manual")?.title).toBe(manual.document.question);
  expect(byFinding.get("retained")?.title).toBe("Original claim");
});

it("respects an explicit claim when several rooms have identical questions", () => {
  const v = version("result", "Same question", { claimId: "right" });
  const { rooms } = groupClaimSpaces(
    [],
    ["left", "right"].map((id) => ({ id, text: "Same question" })),
    [v],
    [
      {
        id: "retry",
        claimId: "right",
        question: "Same question",
        message: "Failed",
        created: "2026-11-19",
      },
    ],
  );
  expect(rooms.get("left")).toMatchObject({ versions: [], attempts: [] });
  expect(rooms.get("right")?.versions).toEqual([v]);
  expect(rooms.get("right")?.attempts).toHaveLength(1);
});
