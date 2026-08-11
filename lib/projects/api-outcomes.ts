import type { ProjectOutcome } from "./project-subject";
import { REQUEST_ID_HEADER } from "../request-id";
import {
  createFreeProjectLimitResponse,
  createProjectRegistrationRequiredResponse,
} from "./project-limit-response";

export function projectOutcomeResponse<T>(outcome: ProjectOutcome<T>): Response {
  switch (outcome.kind) {
    case "invalid":
      return Response.json(
        { outcome: "invalid", message: outcome.message },
        { status: 400 },
      );
    case "limit_reached":
      return Response.json(
        createFreeProjectLimitResponse(outcome.projectsUsed),
        { status: 402 },
      );
    case "missing":
      return Response.json(
        { outcome: "missing", message: "Project not found." },
        { status: 404 },
      );
    case "forbidden":
      return Response.json(
        { outcome: "forbidden", message: "Project access is not allowed." },
        { status: 403 },
      );
    case "unavailable":
      return Response.json(
        {
          outcome: "unavailable",
          message: "Projects are temporarily unavailable.",
        },
        { status: 503 },
      );
    case "resolved":
      throw new TypeError("Resolved Project outcomes need a success response.");
  }
}

export function projectRegistrationRequiredResponse(): Response {
  return Response.json(
    createProjectRegistrationRequiredResponse(),
    { status: 402 },
  );
}

export function projectBetaUnavailableResponse(): Response {
  return Response.json(
    {
      outcome: "unavailable",
      errorCode: "project_beta_unavailable",
      message: "Projects are available to invited beta Researchers only.",
    },
    { status: 403 },
  );
}

export function projectUnavailableResponse(requestId: string): Response {
  return Response.json(
    {
      outcome: "unavailable",
      message: "Projects are temporarily unavailable.",
    },
    {
      status: 503,
      headers: {
        [REQUEST_ID_HEADER]: requestId,
        "X-Error-ID": "PROJECTS_UNAVAILABLE",
      },
    },
  );
}

export function authOutcomeResponse(
  outcome: "missing" | "anonymous" | "unavailable",
): Response {
  if (outcome === "missing") {
    return Response.json(
      { outcome: "unauthenticated", message: "Sign in to use Projects." },
      { status: 401 },
    );
  }
  if (outcome === "anonymous") {
    return Response.json(
      {
        outcome: "forbidden",
        message: "Create an account to use private Projects.",
      },
      { status: 403 },
    );
  }
  return Response.json(
    {
      outcome: "unavailable",
      message: "Authentication is temporarily unavailable.",
    },
    { status: 503 },
  );
}
