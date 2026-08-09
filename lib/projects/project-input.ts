import { z } from "zod";

const projectName = z
  .string()
  .trim()
  .min(1, "Enter a project name.")
  .max(120, "Project names can be up to 120 characters.");

const projectGoal = z
  .string()
  .trim()
  .max(2000, "Project goals can be up to 2,000 characters.")
  .transform((value) => (value === "" ? null : value));

export const projectIdSchema = z.uuid("That project link is not valid.");

export const createProjectSchema = z
  .object({
    name: projectName,
    goal: projectGoal.optional().default(null),
  })
  .strict();

export const updateProjectSchema = z
  .object({
    name: projectName.optional(),
    goal: projectGoal.optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.goal !== undefined, {
    message: "Choose a project detail to update.",
  });

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
