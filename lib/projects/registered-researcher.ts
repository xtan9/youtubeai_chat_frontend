import "server-only";

import {
  resolveRequestPrincipal,
  type RequestPrincipalSource,
} from "@/lib/auth/request-principal";
import { authOutcomeResponse } from "./api-outcomes";
import {
  projectBetaUnavailableResponse,
  projectRegistrationRequiredResponse,
} from "./api-outcomes";
import { hasProjectAvailability } from "./project-availability";

type ProjectPrincipalSource = Extract<
  RequestPrincipalSource,
  "workspace_projects" | "project"
>;

export async function requireRegisteredResearcher(
  source: ProjectPrincipalSource,
  options: { projectCreation?: boolean } = {},
) {
  const result = await resolveRequestPrincipal({ source });
  if (result.kind === "unavailable") {
    return { kind: "error", response: authOutcomeResponse("unavailable") } as const;
  }
  if (result.kind === "missing") {
    return {
      kind: "error",
      response: options.projectCreation
        ? projectRegistrationRequiredResponse()
        : authOutcomeResponse("missing"),
    } as const;
  }
  if (result.principal.isAnonymous) {
    return {
      kind: "error",
      response: options.projectCreation
        ? projectRegistrationRequiredResponse()
        : authOutcomeResponse("anonymous"),
    } as const;
  }
  if (!hasProjectAvailability(result.principal.projectAvailability)) {
    return {
      kind: "error",
      response: projectBetaUnavailableResponse(),
    } as const;
  }
  return { kind: "resolved", principal: result.principal } as const;
}
