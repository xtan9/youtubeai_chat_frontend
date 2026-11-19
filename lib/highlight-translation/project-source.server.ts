import "server-only";
import { createClient } from "@/lib/supabase/server";
import { resolveProjectSubject } from "@/lib/projects/project-subject";
import { loadResearchVersion } from "@/lib/projects/project-research-journal";
import { spaceSchema, type Space } from "@/lib/video-space/contract";
import type { ResearchDocument } from "@/lib/projects/project-research-contract";
import { findingReferences } from "@/lib/video-space/claim-spaces";
import { boundContext, normalizePassage, type ProjectTranslationRequest } from "./contract";

// Only reading surfaces can supply context. Drafts and writing-partner messages
// share the stored document but are outside the claim room.
function* spacePassages(space: Space) {
  for (const resource of space.resources) {
    for (const claim of resource.digest?.claims ?? []) {
      yield claim.text;
      yield claim.quote;
    }
    if (resource.kind === "pdf") for (const page of resource.pages) yield page.text;
  }
  for (const claim of space.customClaims ?? []) yield claim.text;
  for (const attempt of space.researchAttempts ?? []) {
    yield attempt.question;
    if (attempt.origin) yield attempt.origin.quote;
  }
  for (const turn of space.claimDiscussion ?? []) {
    yield turn.question;
    yield turn.reply;
  }
}

function* researchPassages(d: ResearchDocument) {
  yield d.question;
  if (d.space?.claimTitle) yield d.space.claimTitle;
  if (d.space?.origin) yield d.space.origin.quote;
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

function matchPassage(candidates: Iterable<string>, input: ProjectTranslationRequest) {
  for (const value of candidates) {
    const paragraph = normalizePassage(value);
    if (!paragraph.startsWith(input.text, input.selectionStart)) continue;
    const context = boundContext(paragraph, input.selectionStart);
    if (context === input.context) return { text: input.text, context, heading: "" };
  }
  return null;
}

const fail = (status: number, code: string) =>
  Response.json({ code }, { status, headers: { "Cache-Control": "no-store" } });

export async function resolveProjectTranslation(userId: string, input: ProjectTranslationRequest) {
  try {
    const client = await createClient();
    const subject = await resolveProjectSubject(client, userId, input.projectId);
    if (subject.kind === "unavailable") return fail(503, "UNAVAILABLE");
    if (subject.kind !== "resolved") return fail(404, "PROJECT_UNAVAILABLE");
    const stale = () => fail(409, "PASSAGE_CHANGED");
    if (input.versionId) {
      const version = await loadResearchVersion(client, input.projectId, input.versionId);
      return (version && matchPassage(researchPassages(version.document), input)) ?? stale();
    }
    const { data, error } = await client.from("video_spaces").select("document")
      .eq("project_id", input.projectId).maybeSingle();
    if (error) return fail(503, "UNAVAILABLE");
    if (!data) return stale();
    return matchPassage(spacePassages(spaceSchema.parse(data.document)), input) ?? stale();
  } catch {
    return fail(503, "UNAVAILABLE");
  }
}
