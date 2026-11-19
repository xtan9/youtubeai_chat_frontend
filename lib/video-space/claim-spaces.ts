import type {
  ResearchDocument,
  ResearchVersion,
} from "@/lib/projects/project-research-contract";
import type { Resource, Space } from "./contract";

export type ClaimOrigin = NonNullable<ResearchDocument["space"]>["origin"];
export type ResearchAttempt = NonNullable<Space["researchAttempts"]>[number];
export type ClaimSpace = {
  id: string;
  title: string;
  origin?: ClaimOrigin;
  resource?: Resource;
  seconds?: number;
  versions: ResearchVersion[];
  attempts: ResearchAttempt[];
};

export function findingReferences({ synthesis }: ResearchDocument) {
  return [
    synthesis.judgment,
    ...synthesis.findings,
    synthesis.reasoning,
  ].flatMap((observation) => observation.references);
}

function anchor(origin: NonNullable<ClaimOrigin>) {
  return JSON.stringify([origin.id, origin.location, origin.quote]);
}

export function groupClaimSpaces(
  resources: Space["resources"],
  customClaims: Space["customClaims"],
  versions: ResearchVersion[],
  attempts: Space["researchAttempts"],
) {
  const rooms = new Map<string, ClaimSpace>();
  const byFinding = new Map<string, ClaimSpace>();
  const anchors = new Map<string, ClaimSpace[]>();
  function add(
    id: string,
    title: string,
    origin?: ClaimOrigin,
    resource?: Resource,
    seconds?: number,
  ) {
    const room: ClaimSpace = {
      id,
      title,
      origin,
      resource,
      seconds,
      versions: [],
      attempts: [],
    };
    rooms.set(id, room);
    return room;
  }
  for (const resource of resources) {
    for (const claim of resource.digest?.claims ?? []) {
      if (!claim.id || rooms.has(claim.id)) continue;
      const origin = {
        id: resource.id,
        title: resource.title,
        location: claim.location,
        quote: claim.quote,
      };
      const room = add(claim.id, claim.text, origin, resource, claim.seconds);
      const key = anchor(origin);
      anchors.set(key, [...(anchors.get(key) ?? []), room]);
    }
  }
  for (const claim of customClaims ?? []) add(claim.id, claim.text);
  function resolve(
    id: string,
    question: string,
    claimId?: string,
    origin?: ClaimOrigin,
    parentId?: string,
    title?: string,
  ) {
    if (claimId)
      return rooms.get(claimId) ?? add(claimId, title ?? question, origin);
    const parent = parentId ? byFinding.get(parentId) : undefined;
    if (!origin) return parent ?? add(id, question);
    const key = anchor(origin);
    if (parent?.origin && anchor(parent.origin) === key) return parent;
    const matches = anchors.get(key) ?? [];
    if (matches.length === 1) return matches[0];
    const exact = matches.find((room) => room.title === question);
    if (exact) return exact;
    return add(id, question, origin);
  }
  // Storage returns newest first. Resolve parents before their follow-ups.
  for (const v of versions.slice().reverse()) {
    const d = v.document;
    const room = resolve(
      "run-" + v.id,
      d.question,
      d.space?.claimId,
      d.space?.origin,
      d.space?.followUpTo,
      d.space?.claimTitle,
    );
    room.versions.push(v);
    byFinding.set(v.id, room);
  }
  for (const attempt of attempts ?? []) {
    resolve(
      "attempt-" + attempt.id,
      attempt.question,
      attempt.claimId,
      attempt.origin,
      attempt.parent,
    ).attempts.push(attempt);
  }
  return { rooms, byFinding };
}

export function claimSourceLink(room: ClaimSpace) {
  if (!room.resource?.url) return;
  const link = new URL(room.resource.url);
  if (room.seconds !== undefined)
    link.searchParams.set("t", room.seconds + "s");
  if (room.resource.kind === "web" && room.origin)
    link.hash = ":~:text=" + encodeURIComponent(room.origin.quote);
  return link.href;
}
