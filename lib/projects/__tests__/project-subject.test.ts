import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createProject,
  deleteProject,
  listWorkspaceProjects,
  openProject,
  resolveProjectSubject,
  updateProject,
} from "../project-subject";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const WORKSPACE_ID = "b0000000-0000-4000-8000-000000000001";
const PROJECT_ID = "a0000000-0000-4000-8000-000000000001";
const PROJECT_ROW = {
  id: PROJECT_ID,
  name: "Evidence review",
  goal: "Compare explanations",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  last_active_at: "2026-08-02T00:00:00.000Z",
};

type QueryResult = { data: unknown; error: unknown };

function builder(result: QueryResult) {
  const value = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    then: (
      resolve: (result: QueryResult) => unknown,
      reject?: (error: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  value.select.mockReturnValue(value);
  value.eq.mockReturnValue(value);
  value.order.mockReturnValue(value);
  value.insert.mockReturnValue(value);
  value.update.mockReturnValue(value);
  value.delete.mockReturnValue(value);
  return value;
}

function client(...queries: ReturnType<typeof builder>[]) {
  let index = 0;
  return { from: vi.fn(() => queries[index++]) };
}

function workspaceQuery() {
  return builder({ data: { id: WORKSPACE_ID }, error: null });
}

describe("ProjectSubject ownership boundary", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("lists only the server-resolved Workspace in recent order", async () => {
    const workspace = workspaceQuery();
    const projects = builder({ data: [PROJECT_ROW], error: null });
    const supabase = client(workspace, projects);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await listWorkspaceProjects(supabase as any, USER_ID);

    expect(workspace.eq).toHaveBeenCalledWith("owner_id", USER_ID);
    expect(projects.eq).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(projects.order).toHaveBeenNthCalledWith(1, "last_active_at", {
      ascending: false,
    });
    expect(projects.order).toHaveBeenNthCalledWith(2, "id", { ascending: false });
    expect(result).toEqual({
      kind: "resolved",
      value: {
        id: WORKSPACE_ID,
        projects: [
          {
            id: PROJECT_ID,
            name: "Evidence review",
            goal: "Compare explanations",
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
            lastActiveAt: "2026-08-02T00:00:00.000Z",
          },
        ],
      },
    });
  });

  it("creates in the resolved Workspace and never accepts owner/workspace input", async () => {
    const insert = builder({ data: PROJECT_ROW, error: null });
    const supabase = client(workspaceQuery(), insert);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await createProject(supabase as any, USER_ID, {
      name: "Evidence review",
      goal: "Compare explanations",
    });

    expect(insert.insert).toHaveBeenCalledWith({
      workspace_id: WORKSPACE_ID,
      name: "Evidence review",
      goal: "Compare explanations",
    });
    expect(result.kind).toBe("resolved");
  });

  it("classifies only the stable database Project-limit signal as a cap hit", async () => {
    const capped = builder({
      data: null,
      error: { code: "P0001", message: "FREE_PROJECT_LIMIT_REACHED" },
    });
    const cappedClient = client(workspaceQuery(), capped);

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createProject(cappedClient as any, USER_ID, {
        name: "Second Project",
        goal: null,
      }),
    ).resolves.toEqual({
      kind: "limit_reached",
      projectsUsed: 1,
      projectsLimit: 1,
    });

    const unrelated = builder({
      data: null,
      error: { code: "P0001", message: "SOME_OTHER_TRIGGER_FAILURE" },
    });
    const unavailableClient = client(workspaceQuery(), unrelated);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createProject(unavailableClient as any, USER_ID, {
        name: "Second Project",
        goal: null,
      }),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("models Goal only as guidance on the resolved subject", async () => {
    const project = builder({ data: PROJECT_ROW, error: null });
    const supabase = client(workspaceQuery(), project);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await resolveProjectSubject(supabase as any, USER_ID, PROJECT_ID);

    expect(project.eq).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(result).toEqual({
      kind: "resolved",
      value: {
        kind: "project",
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        ownerId: USER_ID,
        name: "Evidence review",
        guidance: { goal: "Compare explanations" },
        lastActiveAt: "2026-08-02T00:00:00.000Z",
        passageSearch: { search: expect.any(Function) },
        groundedAnswers: {
          load: expect.any(Function),
          start: expect.any(Function),
          cancel: expect.any(Function),
          complete: expect.any(Function),
        },
        conversations: {
          list: expect.any(Function),
          create: expect.any(Function),
          rename: expect.any(Function),
          clear: expect.any(Function),
        },
      },
    });
    if (result.kind === "resolved") {
      expect(result.value).not.toHaveProperty("evidence");
      expect(result.value.passageSearch).toBeDefined();
      expect(result.value.groundedAnswers).toBeDefined();
    }
  });

  it("classifies invalid and missing IDs without throwing", async () => {
    const invalidClient = client();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invalid = await resolveProjectSubject(invalidClient as any, USER_ID, "bad");
    expect(invalid.kind).toBe("invalid");
    expect(invalidClient.from).not.toHaveBeenCalled();

    const missingClient = client(
      workspaceQuery(),
      builder({ data: null, error: null }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(resolveProjectSubject(missingClient as any, USER_ID, PROJECT_ID)).resolves.toEqual({
      kind: "missing",
    });
  });

  it("classifies RLS denial and infrastructure failure", async () => {
    const denied = client(builder({ data: null, error: { code: "42501" } }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(listWorkspaceProjects(denied as any, USER_ID)).resolves.toEqual({
      kind: "forbidden",
    });

    const unavailable = client(builder({ data: null, error: { code: "08006" } }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(listWorkspaceProjects(unavailable as any, USER_ID)).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it("touches activity when a Project is opened", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T12:00:00.000Z"));
    const resolveQuery = builder({ data: PROJECT_ROW, error: null });
    const touchQuery = builder({
      data: { ...PROJECT_ROW, last_active_at: "2026-08-08T12:00:00.000Z" },
      error: null,
    });
    const supabase = client(workspaceQuery(), resolveQuery, touchQuery);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await openProject(supabase as any, USER_ID, PROJECT_ID);

    expect(touchQuery.update).toHaveBeenCalledWith({
      last_active_at: "2026-08-08T12:00:00.000Z",
    });
    expect(result.kind).toBe("resolved");
  });

  it("updates and deletes only after resolving the owned subject", async () => {
    const updateQuery = builder({
      data: { ...PROJECT_ROW, name: "Renamed", goal: null },
      error: null,
    });
    const updateClient = client(
      workspaceQuery(),
      builder({ data: PROJECT_ROW, error: null }),
      updateQuery,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = await updateProject(updateClient as any, USER_ID, PROJECT_ID, {
      name: "Renamed",
      goal: null,
    });
    expect(updateQuery.update).toHaveBeenCalledWith({ name: "Renamed", goal: null });
    expect(updateQuery.eq).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(updated.kind).toBe("resolved");

    const deleteQuery = builder({ data: { id: PROJECT_ID }, error: null });
    const deleteClient = client(
      workspaceQuery(),
      builder({ data: PROJECT_ROW, error: null }),
      deleteQuery,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(deleteProject(deleteClient as any, USER_ID, PROJECT_ID)).resolves.toEqual({
      kind: "resolved",
      value: { id: PROJECT_ID },
    });
    expect(deleteQuery.delete).toHaveBeenCalledOnce();
    expect(deleteQuery.eq).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
  });
});
