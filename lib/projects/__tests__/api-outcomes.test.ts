import { describe, expect, it } from "vitest";
import { authOutcomeResponse, projectOutcomeResponse } from "../api-outcomes";

describe("classified Project HTTP outcomes", () => {
  it.each([
    [{ kind: "invalid", message: "Bad ID" } as const, 400, "invalid"],
    [{ kind: "missing" } as const, 404, "missing"],
    [{ kind: "forbidden" } as const, 403, "forbidden"],
    [{ kind: "unavailable" } as const, 503, "unavailable"],
  ])("maps %s to status %s", async (outcome, status, kind) => {
    const response = projectOutcomeResponse(outcome);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ outcome: kind });
  });

  it.each([
    ["missing" as const, 401, "unauthenticated"],
    ["anonymous" as const, 403, "forbidden"],
    ["unavailable" as const, 503, "unavailable"],
  ])("classifies auth outcome %s", async (outcome, status, kind) => {
    const response = authOutcomeResponse(outcome);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ outcome: kind });
  });
});
