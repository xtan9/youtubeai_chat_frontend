import "server-only";

import { projectOutcomeResponse } from "./api-outcomes";
import { requireRegisteredResearcher } from "./registered-researcher";
import { resolveProjectSubject } from "./project-subject";
import { createClient } from "@/lib/supabase/server";
import type { ProjectConversationManagementCapability } from "./project-grounded-answer-contract";

type ProjectConversationManagementResolution =
  | { readonly capability: ProjectConversationManagementCapability }
  | { readonly response: Response };

/**
 * Shared authenticated Project boundary for conversation management routes.
 * Every mutation and list operation resolves ownership through ProjectSubject
 * before invoking an RPC capability; callers never pass owner IDs from JSON.
 */
export async function resolveProjectConversationManagement(
  projectId: string,
): Promise<ProjectConversationManagementResolution> {
  const researcher = await requireRegisteredResearcher("project");
  if (researcher.kind === "error") return { response: researcher.response };

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return {
      response: Response.json(
        {
          outcome: "unavailable",
          message: "Project conversations are temporarily unavailable.",
        },
        { status: 503 },
      ),
    };
  }

  const subject = await resolveProjectSubject(
    supabase,
    researcher.principal.userId,
    projectId,
  );
  if (subject.kind !== "resolved") {
    return { response: projectOutcomeResponse(subject) };
  }
  if (!subject.value.conversations) {
    return {
      response: Response.json(
        {
          outcome: "unavailable",
          message: "Project conversations are temporarily unavailable.",
        },
        { status: 503 },
      ),
    };
  }
  return { capability: subject.value.conversations };
}
