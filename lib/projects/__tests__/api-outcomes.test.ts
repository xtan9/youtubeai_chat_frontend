import { describe, expect, it } from "vitest";
import {
  authOutcomeResponse,
  projectOutcomeResponse,
  projectRegistrationRequiredResponse,
} from "../api-outcomes";
import { decodeProjectLimitResponse } from "../project-limit-response";

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

  it("uses the stable Project-specific 402 upgrade envelope", async () => {
    const response = projectOutcomeResponse({
      kind: "limit_reached",
      projectsUsed: 1,
      projectsLimit: 1,
    });

    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body).toEqual({
      message:
        "Free includes 1 Project. Upgrade to Pro to create unlimited Projects within technical and abuse limits.",
      errorCode: "free_project_limit_reached",
      tier: "free",
      upgradeUrl: "/pricing",
      projectsUsed: 1,
      projectsLimit: 1,
    });
    expect(decodeProjectLimitResponse(body)).toEqual(body);
  });

  it("uses the same envelope with a registration action for visitors", async () => {
    const response = projectRegistrationRequiredResponse();
    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body).toEqual({
      message: "Create a free account to start your private Project.",
      errorCode: "anon_project_registration_required",
      tier: "anon",
      upgradeUrl: "/auth/sign-up?redirect_to=%2Fworkspace",
      projectsUsed: 0,
      projectsLimit: 0,
    });
    expect(decodeProjectLimitResponse(body)).toEqual(body);
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
