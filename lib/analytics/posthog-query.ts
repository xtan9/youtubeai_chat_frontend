import "server-only";

import { z } from "zod";

const DEFAULT_POSTHOG_QUERY_HOST = "https://us.posthog.com";

const PostHogHogQlResponseSchema = z
  .object({
    columns: z.array(z.string()),
    results: z.array(z.array(z.unknown())),
    is_cached: z.boolean().optional(),
  })
  .passthrough();

export interface PostHogQueryConfiguration {
  host: string;
  projectId: string;
  personalApiKey: string;
}

export interface PostHogHogQlRequest {
  hogql: string;
  name: string;
}

export interface PostHogHogQlResult {
  columns: string[];
  results: unknown[][];
  isCached: boolean;
}

interface PostHogQueryDependencies {
  fetchImpl?: typeof fetch;
  configuration?: PostHogQueryConfiguration;
}

export class PostHogQueryConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostHogQueryConfigurationError";
  }
}

export class PostHogQueryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PostHogQueryError";
  }
}

export async function executePostHogHogQlQuery(
  request: PostHogHogQlRequest,
  dependencies: PostHogQueryDependencies = {},
): Promise<PostHogHogQlResult> {
  const configuration =
    dependencies.configuration ?? readPostHogQueryConfiguration();
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const host = configuration.host.replace(/\/+$/, "");
  const endpoint = `${host}/api/projects/${encodeURIComponent(configuration.projectId)}/query/`;

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${configuration.personalApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: { kind: "HogQLQuery", query: request.hogql },
        name: request.name,
      }),
      cache: "no-store",
    });
  } catch (error) {
    throw new PostHogQueryError("PostHog query request failed", {
      cause: error,
    });
  }

  if (!response.ok) {
    throw new PostHogQueryError(
      `PostHog query failed with status ${response.status}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new PostHogQueryError("PostHog query returned invalid JSON", {
      cause: error,
    });
  }

  const parsed = PostHogHogQlResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new PostHogQueryError("PostHog query returned an invalid response");
  }

  return {
    columns: parsed.data.columns,
    results: parsed.data.results,
    isCached: parsed.data.is_cached === true,
  };
}

export function readPostHogQueryConfiguration(): PostHogQueryConfiguration {
  const projectId = process.env.POSTHOG_PROJECT_ID?.trim();
  const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY?.trim();
  const host =
    process.env.POSTHOG_QUERY_HOST?.trim() || DEFAULT_POSTHOG_QUERY_HOST;

  if (!projectId) {
    throw new PostHogQueryConfigurationError(
      "POSTHOG_PROJECT_ID is not configured",
    );
  }
  if (!personalApiKey) {
    throw new PostHogQueryConfigurationError(
      "POSTHOG_PERSONAL_API_KEY is not configured",
    );
  }

  return { host, projectId, personalApiKey };
}
