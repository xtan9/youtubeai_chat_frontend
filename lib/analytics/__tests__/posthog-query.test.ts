import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  executePostHogHogQlQuery,
  readPostHogQueryConfiguration,
} from "../posthog-query";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("executePostHogHogQlQuery", () => {
  it("executes a named HogQL query with server-only project credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          columns: ["period", "event_count"],
          results: [["current", 4]],
          is_cached: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await executePostHogHogQlQuery(
      {
        hogql: "SELECT 'current' AS period, 4 AS event_count",
        name: "subscription_conversion_funnel_7_day",
      },
      {
        fetchImpl,
        configuration: {
          host: "https://us.posthog.com/",
          projectId: "12345",
          personalApiKey: "phx_secret",
        },
      },
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://us.posthog.com/api/projects/12345/query/",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer phx_secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: {
            kind: "HogQLQuery",
            query: "SELECT 'current' AS period, 4 AS event_count",
          },
          name: "subscription_conversion_funnel_7_day",
        }),
      }),
    );
    expect(result).toEqual({
      columns: ["period", "event_count"],
      results: [["current", 4]],
      isCached: true,
    });
  });

  it("reads and trims the server-only query configuration", () => {
    vi.stubEnv("POSTHOG_PROJECT_ID", " 12345 ");
    vi.stubEnv("POSTHOG_PERSONAL_API_KEY", " phx_secret ");
    vi.stubEnv("POSTHOG_QUERY_HOST", " https://eu.posthog.com/ ");

    expect(readPostHogQueryConfiguration()).toEqual({
      host: "https://eu.posthog.com/",
      projectId: "12345",
      personalApiKey: "phx_secret",
    });
  });

  it("requires both server-only PostHog credentials", () => {
    vi.stubEnv("POSTHOG_PROJECT_ID", "");
    vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "");

    expect(() => readPostHogQueryConfiguration()).toThrow(
      "POSTHOG_PROJECT_ID is not configured",
    );

    vi.stubEnv("POSTHOG_PROJECT_ID", "12345");
    expect(() => readPostHogQueryConfiguration()).toThrow(
      "POSTHOG_PERSONAL_API_KEY is not configured",
    );
  });
});
