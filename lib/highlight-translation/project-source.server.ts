import "server-only";
import { createClient } from "@/lib/supabase/server";
import { resolveProjectSubject } from "@/lib/projects/project-subject";
import { loadResearchVersion } from "@/lib/projects/project-research-journal";
import { emptySpace, spaceSchema, type Space } from "@/lib/video-space/contract";
import { identifySpaceClaims } from "@/lib/video-space/identify-claims.server";
import type { ResearchVersion } from "@/lib/projects/project-research-contract";
import { findingReferences, groupClaimSpaces, type ClaimSpace } from "@/lib/video-space/claim-spaces";
import { boundContext, HEADING_LIMIT, normalizePassage, type ProjectTranslationRequest } from "./contract";

function* visiblePassages(room: ClaimSpace, space: Space, input: ProjectTranslationRequest) {
  if (input.section === "claim") {
    yield room.title;
    const origin = room.origin;
    if (origin) {
      yield origin.quote;
      if (room.resource?.kind === "pdf") {
        const page = room.resource.pages.find(p => p.label === origin.location);
        if (page) yield page.text;
      }
    }
    return;
  }

  const d = room.versions.find(v => v.id === input.versionId)?.document;
  if (input.section === "discussion") {
    for (const turn of space.claimDiscussion ?? []) {
      if (turn.claimId !== room.id) continue;
      yield turn.question;
      yield turn.reply;
    }
    for (const attempt of room.attempts) yield attempt.question;
    if (d) {
      yield d.question;
      yield d.synthesis.judgment.text;
    }
    return;
  }

  if (!d) return;
  yield d.synthesis.judgment.text;
  yield d.synthesis.reasoning.text;
  for (const finding of d.synthesis.findings) yield finding.text;
  yield* d.warnings;
  yield* d.synthesis.uncertainties;
  if (d.synthesis.assessment) {
    yield d.synthesis.assessment.strengthReason;
    yield d.synthesis.assessment.confidenceReason;
  }
  for (const e of d.evidence) yield e.title;
  for (const ref of findingReferences(d)) yield ref.quote;
}

const fail = (status: number, code: string) =>
  Response.json({ code }, { status, headers: { "Cache-Control": "no-store" } });

export async function resolveProjectTranslation(userId: string, input: ProjectTranslationRequest) {
  try {
    const client = await createClient();
    const subject = await resolveProjectSubject(client, userId, input.projectId);
    if (subject.kind === "unavailable") return fail(503, "UNAVAILABLE");
    if (subject.kind !== "resolved") return fail(404, "PROJECT_UNAVAILABLE");
    const { data, error } = await client.from("video_spaces").select("document")
      .eq("project_id", input.projectId).maybeSingle();
    if (error) return fail(503, "UNAVAILABLE");
    const space = data ? identifySpaceClaims(spaceSchema.parse(data.document)) : emptySpace();

    // A legacy follow-up can inherit its room from its parent. Load that chain
    // only when the version predates explicit claim IDs.
    const versions: ResearchVersion[] = [];
    const seen = new Set<string>();
    let id = input.versionId;
    while (id && !seen.has(id)) {
      seen.add(id);
      const version = await loadResearchVersion(client, input.projectId, id);
      if (!version) {
        if (id === input.versionId) return fail(409, "PASSAGE_CHANGED");
        break;
      }
      versions.push(version);
      id = version.document.space?.claimId ? undefined : version.document.space?.followUpTo;
    }
    const { rooms } = groupClaimSpaces(space.resources, space.customClaims, versions, space.researchAttempts);
    const room = rooms.get(input.claimId);
    if (!room) return fail(409, "PASSAGE_CHANGED");
    for (const value of visiblePassages(room, space, input)) {
      const paragraph = normalizePassage(value);
      if (!paragraph.startsWith(input.text, input.selectionStart)) continue;
      const context = boundContext(paragraph, input.selectionStart);
      if (context !== input.context) continue;
      const sectionHeading = { claim: room.title, evidence: "证据", discussion: "围绕这个观点讨论" }[input.section];
      const heading = Array.from(normalizePassage(sectionHeading)).slice(0, HEADING_LIMIT).join("");
      return { text: input.text, context, heading };
    }
    return fail(409, "PASSAGE_CHANGED");
  } catch {
    return fail(503, "UNAVAILABLE");
  }
}
