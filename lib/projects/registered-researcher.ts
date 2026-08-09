import "server-only";

import {
  resolveRequestPrincipal,
  type RequestPrincipalSource,
} from "@/lib/auth/request-principal";
import { authOutcomeResponse } from "./api-outcomes";

type ProjectPrincipalSource = Extract<
  RequestPrincipalSource,
  "workspace_projects" | "project"
>;

export async function requireRegisteredResearcher(
  source: ProjectPrincipalSource,
) {
  const result = await resolveRequestPrincipal({ source });
  if (result.kind === "unavailable") {
    return { kind: "error", response: authOutcomeResponse("unavailable") } as const;
  }
  if (result.kind === "missing") {
    return { kind: "error", response: authOutcomeResponse("missing") } as const;
  }
  if (result.principal.isAnonymous) {
    return { kind: "error", response: authOutcomeResponse("anonymous") } as const;
  }
  return { kind: "resolved", principal: result.principal } as const;
}
