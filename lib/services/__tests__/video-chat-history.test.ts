import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));
vi.mock("server-only", () => ({}));

import {
  appendVideoChatTurn,
  cleanupInactiveAnonymousDemoConversations,
  clearVideoChatMessages,
  listVideoChatMessages,
} from "../video-chat-history";

const THREAD = {
  kind: "hero_demo" as const,
  youtubeVideoId: "Hrbq66XqtCo",
};

describe("Hero Demo Video history adapter", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.getServiceRoleClient.mockReturnValue({ rpc: mocks.rpc });
  });

  it("loads a bounded server-owned conversation for one identity and canonical demo", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        outcome: "ready",
        messages: [
          {
            id: "37600000-0000-4000-8000-000000000011",
            role: "user",
            content: "Continue the explanation",
            createdAt: "2026-08-10T00:00:00.000Z",
          },
        ],
      },
      error: null,
    });

    await expect(listVideoChatMessages("user-376", THREAD)).resolves.toEqual([
      expect.objectContaining({ content: "Continue the explanation" }),
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith("load_hero_demo_conversation", {
      p_user_id: "user-376",
      p_youtube_video_id: "Hrbq66XqtCo",
      p_message_limit: 16,
    });
  });

  it("stores and clears only the selected demo through private RPCs", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { outcome: "stored" }, error: null })
      .mockResolvedValueOnce({
        data: { outcome: "cleared", deletedConversations: 1 },
        error: null,
      });

    await appendVideoChatTurn({
      userId: "user-376",
      thread: THREAD,
      userMessage: "Question",
      assistantMessage: "Answer",
    });
    await clearVideoChatMessages("user-376", THREAD);

    expect(mocks.rpc).toHaveBeenNthCalledWith(
      1,
      "append_hero_demo_chat_turn",
      expect.objectContaining({
        p_user_id: "user-376",
        p_youtube_video_id: "Hrbq66XqtCo",
      }),
    );
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      2,
      "clear_hero_demo_conversation",
      {
        p_user_id: "user-376",
        p_youtube_video_id: "Hrbq66XqtCo",
      },
    );
  });

  it("fails closed when retained history is unavailable or malformed", async () => {
    mocks.rpc.mockResolvedValue({ data: { outcome: "ready", messages: [{}] }, error: null });

    await expect(listVideoChatMessages("user-376", THREAD)).rejects.toThrow(
      /storage unavailable/i,
    );
    mocks.getServiceRoleClient.mockReturnValue(null);
    await expect(listVideoChatMessages("user-376", THREAD)).rejects.toThrow(
      /storage unavailable/i,
    );
  });

  it("runs a bounded anonymous-retention cleanup through the governed bridge", async () => {
    mocks.rpc.mockResolvedValue({
      data: { outcome: "cleaned", deletedConversations: 37 },
      error: null,
    });

    await expect(
      cleanupInactiveAnonymousDemoConversations(500),
    ).resolves.toEqual({ deletedConversations: 37 });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "cleanup_inactive_anonymous_demo_conversations",
      { p_limit: 500 },
    );
  });
});
