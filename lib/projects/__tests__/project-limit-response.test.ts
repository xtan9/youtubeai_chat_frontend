import { describe, expect, it } from "vitest";
import {
  createFreeProjectLimitResponse,
  createProjectRegistrationRequiredResponse,
  decodeProjectLimitResponse,
} from "../project-limit-response";

describe("Project limit response contract", () => {
  it("round-trips both stable 402 variants through the shared decoder", () => {
    const free = createFreeProjectLimitResponse(1);
    const anonymous = createProjectRegistrationRequiredResponse();

    expect(decodeProjectLimitResponse(free)).toEqual(free);
    expect(decodeProjectLimitResponse(anonymous)).toEqual(anonymous);
  });

  it.each([
    null,
    {},
    {
      ...createFreeProjectLimitResponse(1),
      upgradeUrl: "/untrusted-upgrade",
    },
    {
      ...createFreeProjectLimitResponse(1),
      projectName: "private research",
    },
    {
      ...createProjectRegistrationRequiredResponse(),
      projectsLimit: 1,
    },
  ])("rejects malformed or expanded envelopes", (value) => {
    expect(decodeProjectLimitResponse(value)).toBeNull();
  });
});
