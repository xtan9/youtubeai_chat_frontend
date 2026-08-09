import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { projectIdSchema } from "./project-input";
import { createProjectPassageSearchCapability } from "./project-passage-search";
import type { ProjectPassageSearchCapability } from "./project-passage-search-contract";

export type Project = Readonly<{
  id: string;
  name: string;
  goal: string | null;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
}>;

export type PersonalWorkspace = Readonly<{
  id: string;
  projects: readonly Project[];
}>;

/**
 * The server-owned subject expanded by all future Project routes.
 * Project Goal is deliberately isolated as guidance metadata; evidence
 * identity will live on Project Video memberships, never on this field.
 */
export type ProjectSubject = Readonly<{
  kind: "project";
  projectId: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  guidance: Readonly<{ goal: string | null }>;
  lastActiveAt: string;
  passageSearch?: ProjectPassageSearchCapability;
}>;

export type ProjectOutcome<T> =
  | { readonly kind: "resolved"; readonly value: T }
  | { readonly kind: "invalid"; readonly message: string }
  | {
      readonly kind: "limit_reached";
      readonly projectsUsed: 1;
      readonly projectsLimit: 1;
    }
  | { readonly kind: "missing" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "unavailable" };

type WorkspaceRow = { id: string };
type ProjectRow = {
  id: string;
  name: string;
  goal: string | null;
  created_at: string;
  updated_at: string;
  last_active_at: string;
};

const PROJECT_SELECT =
  "id,name,goal,created_at,updated_at,last_active_at";

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActiveAt: row.last_active_at,
  };
}

type DatabaseError = { code?: string; message?: string } | null;

const FREE_PROJECT_LIMIT_DATABASE_MESSAGE = "FREE_PROJECT_LIMIT_REACHED";

function databaseFailureKind(error: DatabaseError) {
  if (error?.code === "42501") return "forbidden" as const;
  if (error?.code === "23514" || error?.code === "23502") {
    return "invalid" as const;
  }
  return "unavailable" as const;
}

function databaseFailure<T>(
  error: DatabaseError,
): ProjectOutcome<T> {
  const kind = databaseFailureKind(error);
  return kind === "invalid"
    ? { kind, message: "Project details are not valid." }
    : { kind };
}

function logFailure(operation: string, userId: string, error: unknown) {
  const safeError = error as { code?: string; message?: string } | null;
  console.error(`[projects] ${operation} failed`, {
    userId,
    code: safeError?.code,
    message: safeError?.message,
  });
}

async function resolveWorkspace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
): Promise<ProjectOutcome<WorkspaceRow>> {
  let result: { data: WorkspaceRow | null; error: DatabaseError };
  try {
    result = await supabase
      .from("workspaces")
      .select("id")
      .eq("owner_id", userId)
      .maybeSingle();
  } catch (error) {
    logFailure("resolve workspace", userId, error);
    return { kind: "unavailable" };
  }

  if (result.error) {
    logFailure("resolve workspace", userId, result.error);
    const kind = databaseFailureKind(result.error);
    return kind === "forbidden" ? { kind } : { kind: "unavailable" };
  }
  if (!result.data) {
    // Provisioning is a database invariant. A missing row is operational,
    // not a friendly empty Workspace, and must not be silently masked.
    logFailure("resolve workspace invariant", userId, null);
    return { kind: "unavailable" };
  }
  return { kind: "resolved", value: result.data };
}

export async function listWorkspaceProjects(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
): Promise<ProjectOutcome<PersonalWorkspace>> {
  const workspace = await resolveWorkspace(supabase, userId);
  if (workspace.kind !== "resolved") return workspace;

  let result: { data: ProjectRow[] | null; error: DatabaseError };
  try {
    result = await supabase
      .from("projects")
      .select(PROJECT_SELECT)
      .eq("workspace_id", workspace.value.id)
      .order("last_active_at", { ascending: false })
      .order("id", { ascending: false });
  } catch (error) {
    logFailure("list", userId, error);
    return { kind: "unavailable" };
  }

  if (result.error) {
    logFailure("list", userId, result.error);
    return databaseFailure<PersonalWorkspace>(result.error);
  }
  return {
    kind: "resolved",
    value: {
      id: workspace.value.id,
      projects: (result.data ?? []).map(mapProject),
    },
  };
}

export async function createProject(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  input: { name: string; goal: string | null },
): Promise<ProjectOutcome<Project>> {
  const workspace = await resolveWorkspace(supabase, userId);
  if (workspace.kind !== "resolved") return workspace;

  let result: { data: ProjectRow | null; error: DatabaseError };
  try {
    result = await supabase
      .from("projects")
      .insert({
        workspace_id: workspace.value.id,
        name: input.name,
        goal: input.goal,
      })
      .select(PROJECT_SELECT)
      .single();
  } catch (error) {
    logFailure("create", userId, error);
    return { kind: "unavailable" };
  }

  if (
    result.error?.code === "P0001" &&
    result.error.message === FREE_PROJECT_LIMIT_DATABASE_MESSAGE
  ) {
    return {
      kind: "limit_reached",
      projectsUsed: 1,
      projectsLimit: 1,
    };
  }
  if (result.error || !result.data) {
    logFailure("create", userId, result.error);
    return databaseFailure<Project>(result.error);
  }
  return { kind: "resolved", value: mapProject(result.data) };
}

export async function resolveProjectSubject(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  rawProjectId: string,
): Promise<ProjectOutcome<ProjectSubject>> {
  const parsedId = projectIdSchema.safeParse(rawProjectId);
  if (!parsedId.success) {
    return { kind: "invalid", message: parsedId.error.issues[0].message };
  }

  const workspace = await resolveWorkspace(supabase, userId);
  if (workspace.kind !== "resolved") return workspace;

  let result: { data: ProjectRow | null; error: DatabaseError };
  try {
    result = await supabase
      .from("projects")
      .select(PROJECT_SELECT)
      .eq("id", parsedId.data)
      .eq("workspace_id", workspace.value.id)
      .maybeSingle();
  } catch (error) {
    logFailure("resolve subject", userId, error);
    return { kind: "unavailable" };
  }

  if (result.error) {
    logFailure("resolve subject", userId, result.error);
    return databaseFailure<ProjectSubject>(result.error);
  }
  if (!result.data) return { kind: "missing" };

  const value: Omit<ProjectSubject, "passageSearch"> = {
    kind: "project",
    projectId: result.data.id,
    workspaceId: workspace.value.id,
    ownerId: userId,
    name: result.data.name,
    guidance: { goal: result.data.goal },
    lastActiveAt: result.data.last_active_at,
  };

  return {
    kind: "resolved",
    value: {
      ...value,
      passageSearch: createProjectPassageSearchCapability(supabase, value),
    },
  };
}

export async function openProject(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  rawProjectId: string,
): Promise<ProjectOutcome<Project>> {
  const subject = await resolveProjectSubject(supabase, userId, rawProjectId);
  if (subject.kind !== "resolved") return subject;

  return openResolvedProject(supabase, subject.value);
}

/**
 * Open an already-authorized Project without repeating Workspace ownership
 * resolution. Project pages use this after resolving one coherent
 * ProjectSubject for metadata, Source Set, and History capabilities.
 */
export async function openResolvedProject(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  subject: ProjectSubject,
): Promise<ProjectOutcome<Project>> {
  let result: { data: ProjectRow | null; error: DatabaseError };
  try {
    result = await supabase
      .from("projects")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", subject.projectId)
      .eq("workspace_id", subject.workspaceId)
      .select(PROJECT_SELECT)
      .maybeSingle();
  } catch (error) {
    logFailure("open", subject.ownerId, error);
    return { kind: "unavailable" };
  }

  if (result.error) {
    logFailure("open", subject.ownerId, result.error);
    return databaseFailure<Project>(result.error);
  }
  if (!result.data) return { kind: "missing" };
  return { kind: "resolved", value: mapProject(result.data) };
}

export async function updateProject(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  rawProjectId: string,
  updates: { name?: string; goal?: string | null },
): Promise<ProjectOutcome<Project>> {
  const subject = await resolveProjectSubject(supabase, userId, rawProjectId);
  if (subject.kind !== "resolved") return subject;

  let result: { data: ProjectRow | null; error: DatabaseError };
  try {
    result = await supabase
      .from("projects")
      .update(updates)
      .eq("id", subject.value.projectId)
      .eq("workspace_id", subject.value.workspaceId)
      .select(PROJECT_SELECT)
      .maybeSingle();
  } catch (error) {
    logFailure("update", userId, error);
    return { kind: "unavailable" };
  }

  if (result.error) {
    logFailure("update", userId, result.error);
    return databaseFailure<Project>(result.error);
  }
  if (!result.data) return { kind: "missing" };
  return { kind: "resolved", value: mapProject(result.data) };
}

export async function deleteProject(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  rawProjectId: string,
): Promise<ProjectOutcome<{ id: string }>> {
  const subject = await resolveProjectSubject(supabase, userId, rawProjectId);
  if (subject.kind !== "resolved") return subject;

  let result: { data: { id: string } | null; error: DatabaseError };
  try {
    result = await supabase
      .from("projects")
      .delete()
      .eq("id", subject.value.projectId)
      .eq("workspace_id", subject.value.workspaceId)
      .select("id")
      .maybeSingle();
  } catch (error) {
    logFailure("delete", userId, error);
    return { kind: "unavailable" };
  }

  if (result.error) {
    logFailure("delete", userId, result.error);
    return databaseFailure<{ id: string }>(result.error);
  }
  if (!result.data) return { kind: "missing" };
  return { kind: "resolved", value: result.data };
}
