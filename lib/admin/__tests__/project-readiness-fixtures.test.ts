import { describe, expect, it, vi } from "vitest";

import { PROJECT_READINESS_FIXTURE_IDS } from "../project-readiness";
import {
  PROJECT_READINESS_FIXTURE_CATALOG_VERSION,
  PROJECT_READINESS_FIXTURE_COMMANDS,
  runProjectReadinessFixtures,
} from "../project-readiness-fixtures";

describe("runProjectReadinessFixtures", () => {
  it("publishes an immutable version for the exact executable fixture catalog", () => {
    expect(PROJECT_READINESS_FIXTURE_CATALOG_VERSION).toBe(2);
    expect(PROJECT_READINESS_FIXTURE_COMMANDS.every(({ timeoutMs }) => timeoutMs > 0)).toBe(
      true,
    );
  });

  it("binds every required gate to at least one explicit executable seam", () => {
    for (const gateId of PROJECT_READINESS_FIXTURE_IDS) {
      expect(
        PROJECT_READINESS_FIXTURE_COMMANDS.some(({ gateIds }) =>
          (gateIds as readonly string[]).includes(gateId),
        ),
        gateId,
      ).toBe(true);
    }
  });

  it("returns one governed result for every required gate when all commands pass", async () => {
    const runCommand = vi.fn().mockResolvedValue({ exitCode: 0 });

    const results = await runProjectReadinessFixtures(runCommand);

    expect(results.map(({ id }) => id)).toEqual(PROJECT_READINESS_FIXTURE_IDS);
    expect(results.every(({ passed }) => passed)).toBe(true);
    expect(runCommand.mock.calls.length).toBeGreaterThan(1);
    expect(runCommand.mock.calls.some(([command]) => command.executable === "psql")).toBe(
      true,
    );
  });

  it("keeps unrelated evidence passing and assigns a bounded actionable class", async () => {
    const runCommand = vi.fn(async (command: { id: string }) => ({
      exitCode: command.id === "grounded_answer_db" ? 2 : 0,
    }));

    const results = await runProjectReadinessFixtures(runCommand);

    expect(results.find(({ id }) => id === "citation_identity")).toEqual({
      id: "citation_identity",
      passed: false,
      failureClass: "grounded_answer_db_failed",
    });
    expect(results.find(({ id }) => id === "analytics_privacy")).toEqual({
      id: "analytics_privacy",
      passed: true,
    });
  });

  it("fails closed when a command cannot start", async () => {
    const results = await runProjectReadinessFixtures(async (command) => {
      if (command.id === "artifact_db") throw new Error("psql unavailable");
      return { exitCode: 0 };
    });

    expect(results.find(({ id }) => id === "artifact_generation_atomic_cap")).toEqual({
      id: "artifact_generation_atomic_cap",
      passed: false,
      failureClass: "artifact_db_unavailable",
    });
  });

  it("classifies a child deadline separately from an unavailable executable", async () => {
    const results = await runProjectReadinessFixtures(async (command) => ({
      exitCode: command.id === "passage_search_db" ? 1 : 0,
      timedOut: command.id === "passage_search_db",
    }));

    expect(results.find(({ id }) => id === "five_source_retrieval")).toEqual({
      id: "five_source_retrieval",
      passed: false,
      failureClass: "passage_search_db_timeout",
    });
  });
});
