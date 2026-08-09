import { describe, expect, expectTypeOf, it } from "vitest";
import {
  PROJECT_LIMIT_CTA_ACTIONS,
  PROJECT_LIMIT_SOURCE_SURFACES,
  ProjectLimitEventSchema,
  type ProjectLimitEventName,
} from "../project-limits";

describe("Project limit analytics contract", () => {
  it("governs event names, source surfaces, CTA actions, and bounded counts", () => {
    expect(PROJECT_LIMIT_SOURCE_SURFACES).toEqual([
      "workspace_header",
      "workspace_create_dialog",
    ]);
    expect(PROJECT_LIMIT_CTA_ACTIONS).toEqual(["upgrade_to_pro"]);
    expectTypeOf<ProjectLimitEventName>().toEqualTypeOf<
      "project_limit_reached" | "project_limit_cta_clicked"
    >();

    expect(
      ProjectLimitEventSchema.safeParse({
        event: "project_limit_cta_clicked",
        properties: {
          source_surface: "workspace_create_dialog",
          tier: "free",
          projects_used: 1,
          projects_limit: 1,
          cta: "upgrade_to_pro",
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    { project_name: "Sensitive research" },
    { project_goal: "Private goal" },
    { projects_used: 0 },
    { projects_limit: 2 },
    { source_surface: "project_card" },
  ])("rejects private, ungoverned, or invalid properties: %j", (override) => {
    expect(
      ProjectLimitEventSchema.safeParse({
        event: "project_limit_reached",
        properties: {
          source_surface: "workspace_header",
          tier: "free",
          projects_used: 1,
          projects_limit: 1,
          ...override,
        },
      }).success,
    ).toBe(false);
  });
});
