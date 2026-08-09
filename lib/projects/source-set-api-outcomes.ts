import type { SourceSetMutationOutcome } from "./project-source-set";

const MESSAGES = {
  duplicate: "That Video is already in this Project.",
  limit_reached:
    "This Source Set already has five Videos, the universal grounding limit.",
  conflict:
    "The Source Set changed in another request. Review the latest order and try again.",
  not_in_history:
    "Choose a Video from your current History before adding it to this Project.",
  not_ready:
    "That History Video is not ready yet. A canonical Transcript and Summary are required.",
  membership_missing: "That Video is no longer in this Project.",
  invalid_order: "The new order must contain every Project Video exactly once.",
  missing: "Project not found.",
  forbidden: "Project access is not allowed.",
  unavailable: "The Project Source Set is temporarily unavailable.",
} as const;

export function sourceSetMutationResponse(
  outcome: SourceSetMutationOutcome,
): Response {
  switch (outcome.kind) {
    case "added":
    case "removed":
    case "reordered":
    case "unchanged":
      return Response.json({ outcome: outcome.kind, sourceSet: outcome.sourceSet });
    case "duplicate":
    case "limit_reached":
    case "conflict":
      return Response.json(
        {
          outcome: outcome.kind,
          message: MESSAGES[outcome.kind],
          sourceSet: outcome.sourceSet,
        },
        { status: 409 },
      );
    case "not_in_history":
    case "not_ready":
    case "invalid_order":
      return Response.json(
        {
          outcome: outcome.kind,
          message: MESSAGES[outcome.kind],
          sourceSet: outcome.sourceSet,
        },
        { status: 400 },
      );
    case "membership_missing":
    case "missing":
      return Response.json(
        {
          outcome: outcome.kind,
          message: MESSAGES[outcome.kind],
          sourceSet: outcome.sourceSet,
        },
        { status: 404 },
      );
    case "forbidden":
      return Response.json(
        { outcome: outcome.kind, message: MESSAGES[outcome.kind] },
        { status: 403 },
      );
    case "unavailable":
      return Response.json(
        { outcome: outcome.kind, message: MESSAGES[outcome.kind] },
        { status: 503 },
      );
  }
}
