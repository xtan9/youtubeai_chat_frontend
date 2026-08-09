import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createProjectConversationCapability } from "../project-conversations";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001";

function capability(rpc: ReturnType<typeof vi.fn>) {
  return createProjectConversationCapability(
    { rpc } as never,
    { projectId: PROJECT_ID, ownerId: "90000000-0000-4000-8000-000000000001" },
  );
}

describe("Project conversation management boundary", () => {
  it("uses authenticated owner-scoped RPCs and keeps shared quota separate from a thread", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        error: null,
        data: {
          outcome: "ready",
          conversations: [
            {
              id: CONVERSATION_ID,
              name: "Launch questions",
              createdAt: "2026-08-09T00:00:00.000Z",
              updatedAt: "2026-08-09T00:01:00.000Z",
              messageCount: 2,
            },
          ],
          messagesUsed: 4,
          messagesLimit: 5,
          tier: "free",
        },
      })
      .mockResolvedValueOnce({
        error: null,
        data: {
          outcome: "created",
          conversation: {
            id: "30000000-0000-4000-8000-000000000002",
            name: "Comparison",
            createdAt: "2026-08-09T00:02:00.000Z",
            updatedAt: "2026-08-09T00:02:00.000Z",
            messageCount: 0,
          },
        },
      })
      .mockResolvedValueOnce({ error: null, data: { outcome: "renamed" } })
      .mockResolvedValueOnce({ error: null, data: { outcome: "cleared" } });

    const target = capability(rpc);

    await expect(target.list()).resolves.toEqual({
      status: "ready",
      conversations: [
        expect.objectContaining({
          conversationId: CONVERSATION_ID,
          name: "Launch questions",
          messageCount: 2,
        }),
      ],
      messagesUsed: 4,
      messagesLimit: 5,
      tier: "free",
    });
    await expect(target.create("Comparison")).resolves.toMatchObject({
      status: "created",
      conversation: expect.objectContaining({ name: "Comparison" }),
    });
    await expect(target.rename(CONVERSATION_ID, "Renamed")).resolves.toEqual({
      status: "renamed",
    });
    await expect(target.clear(CONVERSATION_ID)).resolves.toEqual({
      status: "cleared",
    });

    expect(rpc.mock.calls).toEqual([
      ["list_project_conversations", { p_project_id: PROJECT_ID }],
      [
        "create_project_conversation",
        { p_project_id: PROJECT_ID, p_name: "Comparison" },
      ],
      [
        "rename_project_conversation",
        {
          p_project_id: PROJECT_ID,
          p_conversation_id: CONVERSATION_ID,
          p_name: "Renamed",
        },
      ],
      [
        "clear_project_conversation",
        { p_project_id: PROJECT_ID, p_conversation_id: CONVERSATION_ID },
      ],
    ]);
  });

  it("fails closed when an RPC is missing or returns an invalid outcome", async () => {
    const target = capability(
      vi.fn().mockResolvedValue({ error: { code: "PGRST202" }, data: null }),
    );
    await expect(target.list()).resolves.toEqual({ status: "unavailable" });

    const malformed = capability(
      vi.fn().mockResolvedValue({ error: null, data: { outcome: "ready" } }),
    );
    await expect(malformed.list()).resolves.toEqual({ status: "unavailable" });
  });
});
