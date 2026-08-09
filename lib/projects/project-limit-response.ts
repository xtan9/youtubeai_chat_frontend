import { z } from "zod";

export const FREE_PROJECT_LIMIT_MESSAGE =
  "Free includes 1 Project. Upgrade to Pro to create unlimited Projects within technical and abuse limits.";
export const PROJECT_REGISTRATION_REQUIRED_MESSAGE =
  "Create a free account to start your private Project.";

const FreeProjectLimitResponseSchema = z
  .object({
    message: z.literal(FREE_PROJECT_LIMIT_MESSAGE),
    errorCode: z.literal("free_project_limit_reached"),
    tier: z.literal("free"),
    upgradeUrl: z.literal("/pricing"),
    projectsUsed: z.number().int().min(1).max(10_000),
    projectsLimit: z.literal(1),
  })
  .strict();

const AnonymousProjectLimitResponseSchema = z
  .object({
    message: z.literal(PROJECT_REGISTRATION_REQUIRED_MESSAGE),
    errorCode: z.literal("anon_project_registration_required"),
    tier: z.literal("anon"),
    upgradeUrl: z.literal("/auth/sign-up?redirect_to=%2Fworkspace"),
    projectsUsed: z.literal(0),
    projectsLimit: z.literal(0),
  })
  .strict();

export const ProjectLimitResponseSchema = z.discriminatedUnion("errorCode", [
  FreeProjectLimitResponseSchema,
  AnonymousProjectLimitResponseSchema,
]);

export type ProjectLimitResponse = z.infer<typeof ProjectLimitResponseSchema>;
export type FreeProjectLimitResponse = Extract<
  ProjectLimitResponse,
  { errorCode: "free_project_limit_reached" }
>;

export function createFreeProjectLimitResponse(
  projectsUsed: number,
): FreeProjectLimitResponse {
  return FreeProjectLimitResponseSchema.parse({
    message: FREE_PROJECT_LIMIT_MESSAGE,
    errorCode: "free_project_limit_reached",
    tier: "free",
    upgradeUrl: "/pricing",
    projectsUsed,
    projectsLimit: 1,
  });
}

export function createProjectRegistrationRequiredResponse(): ProjectLimitResponse {
  return {
    message: PROJECT_REGISTRATION_REQUIRED_MESSAGE,
    errorCode: "anon_project_registration_required",
    tier: "anon",
    upgradeUrl: "/auth/sign-up?redirect_to=%2Fworkspace",
    projectsUsed: 0,
    projectsLimit: 0,
  };
}

export function decodeProjectLimitResponse(
  value: unknown,
): ProjectLimitResponse | null {
  const parsed = ProjectLimitResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
