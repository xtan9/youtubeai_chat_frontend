import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import {
  validateResearchSynthesis,
  ResearchVersionSchema,
  type ResearchDocument,
  type ResearchVersion,
} from "./project-research-contract";
import { z } from "zod";

export async function loadResearchVersions(
  client: SupabaseClient,
  projectId: string,
  beforeId?: string,
): Promise<ResearchVersion[]> {
  let query = client
    .from("project_research_runs")
    .select("id,created_at,document")
    .eq("project_id", projectId)
    .eq("state", "completed")
    .order("completed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(10);
  if (beforeId) {
    const cursor = await client
      .from("project_research_runs")
      .select("id,completed_at")
      .eq("project_id", projectId)
      .eq("state", "completed")
      .eq("id", beforeId)
      .maybeSingle();
    const parsed = z
      .object({ id: z.uuid(), completed_at: z.iso.datetime({ offset: true }) })
      .safeParse(cursor.data);
    if (cursor.error || !parsed.success)
      throw new Error("research_cursor_unavailable");
    query = query.or(
      `completed_at.lt.${parsed.data.completed_at},and(completed_at.eq.${parsed.data.completed_at},id.lt.${parsed.data.id})`,
    );
  }
  const { data, error } = await query;
  if (error) throw new Error("research_load_unavailable");
  return z
    .array(ResearchVersionSchema)
    .parse(data)
    .map((version) => {
      validateResearchSynthesis(
        JSON.stringify(version.document.synthesis),
        version.document.evidence,
      );
      return version;
    });
}
function writer() {
  const client = getServiceRoleClient();
  if (!client) throw new Error("research_storage_unavailable");
  return client;
}
export async function reserveResearch(
  projectId: string,
  ownerId: string,
  baseVersionId: string | null,
) {
  const { data, error } = await writer().rpc("reserve_project_research", {
    p_project_id: projectId,
    p_owner_id: ownerId,
    p_base_version_id: baseVersionId,
  });
  if (error) throw new Error("research_reservation_unavailable");
  return z
    .discriminatedUnion("outcome", [
      z.object({ outcome: z.literal("started"), id: z.uuid() }),
      z.object({
        outcome: z.enum(["missing", "busy", "conflict", "limit_reached"]),
      }),
    ])
    .parse(data);
}
export async function failResearch(projectId: string, id: string) {
  const { error } = await writer()
    .from("project_research_runs")
    .update({ state: "failed" })
    .eq("id", id)
    .eq("project_id", projectId)
    .eq("state", "reserved");
  if (error) throw new Error("research_release_unavailable");
}
export async function completeResearch(
  id: string,
  ownerId: string,
  document: ResearchDocument,
) {
  const { data, error } = await writer().rpc("complete_project_research", {
    p_run_id: id,
    p_owner_id: ownerId,
    p_document: document,
    p_source_set_revision: document.sourceSetRevision,
  });
  if (error) throw new Error("research_save_unavailable");
  return z
    .discriminatedUnion("outcome", [
      z.object({
        outcome: z.literal("completed"),
        version: ResearchVersionSchema,
      }),
      z.object({ outcome: z.enum(["conflict", "invalid"]) }),
    ])
    .parse(data);
}
