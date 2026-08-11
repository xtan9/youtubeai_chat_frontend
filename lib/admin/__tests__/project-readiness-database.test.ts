import { describe, expect, it } from "vitest";

import { resolveDisposableReadinessDatabase } from "../project-readiness-database";

const safeEnvironment = {
  PROJECT_READINESS_ALLOW_DATABASE_FIXTURES: "true",
  PROJECT_READINESS_DATABASE_URL:
    "postgresql://postgres:fixture@127.0.0.1:54329/project_readiness_issue328",
  PROJECT_READINESS_DATABASE_NAME: "project_readiness_issue328",
  PROJECT_READINESS_DATABASE_HOST_ALLOWLIST: "127.0.0.1,localhost",
  PROJECT_READINESS_DATABASE_NAME_ALLOWLIST:
    "project_readiness_issue328,project_readiness_ci",
};

describe("resolveDisposableReadinessDatabase", () => {
  it("returns only an explicitly named, allowlisted disposable target", () => {
    expect(resolveDisposableReadinessDatabase(safeEnvironment)).toEqual({
      databaseUrl: safeEnvironment.PROJECT_READINESS_DATABASE_URL,
      databaseName: "project_readiness_issue328",
      hostname: "127.0.0.1",
    });
  });

  it.each([
    ["boolean acknowledgement alone", {
      PROJECT_READINESS_ALLOW_DATABASE_FIXTURES: "true",
    }],
    ["a URL/name mismatch", {
      ...safeEnvironment,
      PROJECT_READINESS_DATABASE_NAME: "project_readiness_other",
    }],
    ["a host outside the explicit allowlist", {
      ...safeEnvironment,
      PROJECT_READINESS_DATABASE_URL:
        "postgresql://postgres:fixture@database.example.com:5432/project_readiness_issue328",
    }],
    ["a name outside the explicit allowlist", {
      ...safeEnvironment,
      PROJECT_READINESS_DATABASE_NAME: "project_readiness_unlisted",
      PROJECT_READINESS_DATABASE_URL:
        "postgresql://postgres:fixture@127.0.0.1:54329/project_readiness_unlisted",
    }],
    ["a non-disposable database name", {
      ...safeEnvironment,
      PROJECT_READINESS_DATABASE_NAME: "postgres",
      PROJECT_READINESS_DATABASE_URL:
        "postgresql://postgres:fixture@127.0.0.1:54329/postgres",
      PROJECT_READINESS_DATABASE_NAME_ALLOWLIST: "postgres",
    }],
    ["a libpq host override", {
      ...safeEnvironment,
      PROJECT_READINESS_DATABASE_URL:
        `${safeEnvironment.PROJECT_READINESS_DATABASE_URL}?host=production-db`,
    }],
    ["a libpq database override", {
      ...safeEnvironment,
      PROJECT_READINESS_DATABASE_URL:
        `${safeEnvironment.PROJECT_READINESS_DATABASE_URL}?dbname=postgres`,
    }],
    ["a libpq service override", {
      ...safeEnvironment,
      PROJECT_READINESS_DATABASE_URL:
        `${safeEnvironment.PROJECT_READINESS_DATABASE_URL}?service=production`,
    }],
  ])("rejects %s before psql can start", (_label, environment) => {
    expect(() => resolveDisposableReadinessDatabase(environment)).toThrow(
      /disposable Project readiness database/i,
    );
  });
});
