import { describe, expect, it } from "vitest";
import {
  createProjectSchema,
  projectIdSchema,
  updateProjectSchema,
} from "../project-input";

describe("Project input contracts", () => {
  it("trims the name and stores a blank Goal as null", () => {
    expect(createProjectSchema.parse({ name: "  Research plan  ", goal: "  " })).toEqual({
      name: "Research plan",
      goal: null,
    });
  });

  it("rejects blank and oversized metadata", () => {
    expect(createProjectSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: "x".repeat(121) }).success).toBe(false);
    expect(
      createProjectSchema.safeParse({ name: "Valid", goal: "x".repeat(2001) }).success,
    ).toBe(false);
  });

  it("requires PATCH to change at least one supported field", () => {
    expect(updateProjectSchema.safeParse({}).success).toBe(false);
    expect(updateProjectSchema.safeParse({ name: "Renamed" }).success).toBe(true);
    expect(updateProjectSchema.safeParse({ ownerId: "not-allowed" }).success).toBe(false);
  });

  it("classifies malformed Project IDs before database access", () => {
    expect(projectIdSchema.safeParse("not-a-project-id").success).toBe(false);
    expect(
      projectIdSchema.safeParse("a0000000-0000-4000-8000-000000000001").success,
    ).toBe(true);
  });
});
