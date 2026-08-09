import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ProjectPassageSearchDatabaseResultSchema,
  type ProjectPassageSearchCapability,
  type ProjectPassageSearchInput,
  type ProjectPassageSearchResolution,
} from "./project-passage-search-contract";

type ProjectPassageSearchTarget = Readonly<{
  projectId: string;
  ownerId: string;
}>;

function logSearchFailure(
  target: ProjectPassageSearchTarget,
  errorClass: "DatabaseError" | "SchemaMismatch" | "AdapterError",
  code?: string,
) {
  // Do not log the query, passage text, Video metadata, or database message.
  console.error("[project-passage-search] search unavailable", {
    errorId: "PROJECT_PASSAGE_SEARCH_UNAVAILABLE",
    projectId: target.projectId,
    ownerId: target.ownerId,
    errorClass,
    code,
  });
}

function mapDatabaseResult(
  value: unknown,
  target: ProjectPassageSearchTarget,
): ProjectPassageSearchResolution {
  const parsed = ProjectPassageSearchDatabaseResultSchema.safeParse(value);
  if (!parsed.success) {
    logSearchFailure(target, "SchemaMismatch");
    return { status: "unavailable" };
  }

  switch (parsed.data.outcome) {
    case "ready":
    case "no_results":
    case "not_ready": {
      const { outcome: status, ...payload } = parsed.data;
      return { status, ...payload };
    }
    case "invalid":
    case "missing":
      return { status: parsed.data.outcome };
  }
}

export function createProjectPassageSearchCapability(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  target: ProjectPassageSearchTarget,
): ProjectPassageSearchCapability {
  return {
    async search(
      input: ProjectPassageSearchInput,
    ): Promise<ProjectPassageSearchResolution> {
      try {
        const result = await supabase.rpc("search_project_transcript_passages", {
          p_project_id: target.projectId,
          p_query: input.query,
          p_limit: input.limit,
        });

        if (result.error) {
          logSearchFailure(target, "DatabaseError", result.error.code);
          return { status: "unavailable" };
        }
        return mapDatabaseResult(result.data, target);
      } catch (error) {
        logSearchFailure(
          target,
          "AdapterError",
          error instanceof Error ? error.name : typeof error,
        );
        return { status: "unavailable" };
      }
    },
  };
}
