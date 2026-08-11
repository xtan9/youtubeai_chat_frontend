import { SMOKE_ACCOUNT_METADATA_KEY } from "@/lib/auth/smoke-account";

export const PROJECT_BETA_ACCESS_METADATA_KEY =
  "project_beta_access" as const;

export type ProjectAvailability = "internal" | "invited" | "unavailable";

type AvailabilityIdentity = Readonly<{
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}>;

/**
 * Resolves the controlled Project rollout from service-managed Auth metadata.
 * Missing or malformed markers fail closed; user-editable metadata is ignored.
 */
export function resolveProjectAvailability(
  user: AvailabilityIdentity | null | undefined,
): ProjectAvailability {
  if (user?.app_metadata?.[SMOKE_ACCOUNT_METADATA_KEY] === true) {
    return "internal";
  }

  const marker = user?.app_metadata?.[PROJECT_BETA_ACCESS_METADATA_KEY];
  return marker === "internal" || marker === "invited"
    ? marker
    : "unavailable";
}

export function hasProjectAvailability(
  availability: ProjectAvailability | undefined,
): availability is Exclude<ProjectAvailability, "unavailable"> {
  return availability === "internal" || availability === "invited";
}
