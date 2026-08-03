import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import {
  getVideoUsersDisclosure,
  VideoUserDisclosureError,
} from "../video-user-disclosure";
import { VIDEO_USERS_DRILLDOWN_CAP } from "@/lib/admin/admin-constants";

interface ChainScript {
  table: string;
  response: { data: unknown; error: unknown };
  expect?: (calls: ChainCall[]) => void;
}

interface ChainCall {
  method: string;
  args: unknown[];
}

function buildClient(
  scripts: ChainScript[],
  getUserById: (id: string) =>
    | { data: unknown; error: unknown }
    | Promise<{ data: unknown; error: unknown }>,
): SupabaseClient {
  let index = 0;
  const from = vi.fn((table: string) => {
    const script = scripts[index++];
    if (!script) throw new Error(`unexpected from('${table}') call`);
    if (script.table !== table) {
      throw new Error(`expected from('${script.table}'), got '${table}'`);
    }

    const calls: ChainCall[] = [];
    const proxy: Record<string, unknown> = {};
    const chain = (method: string) => (...args: unknown[]) => {
      calls.push({ method, args });
      return proxy;
    };
    proxy.select = chain("select");
    proxy.eq = chain("eq");
    proxy.order = chain("order");
    proxy.limit = chain("limit");
    proxy.then = (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown,
    ) => {
      script.expect?.(calls);
      return Promise.resolve(script.response).then(resolve, reject);
    };
    return proxy;
  });

  return {
    from,
    auth: { admin: { getUserById } },
  } as unknown as SupabaseClient;
}

describe("getVideoUsersDisclosure", () => {
  it("deduplicates to the most recent access and preserves cache/email status", async () => {
    const client = buildClient(
      [
        {
          table: "user_video_history",
          response: {
            data: [
              {
                user_id: "u1",
                video_id: "video-1",
                created_at: "2026-04-05T00:00:00Z",
              },
              {
                user_id: "u1",
                video_id: "video-1",
                created_at: "2026-04-04T00:00:00Z",
              },
              {
                user_id: "u2",
                video_id: "video-1",
                created_at: "2026-04-03T00:00:00Z",
              },
              {
                user_id: "u3",
                video_id: "video-1",
                created_at: "2026-04-02T00:00:00Z",
              },
            ],
            error: null,
          },
          expect: (calls) => {
            expect(calls.find((call) => call.method === "limit")?.args).toEqual([
              VIDEO_USERS_DRILLDOWN_CAP + 1,
            ]);
          },
        },
        {
          table: "summaries",
          response: {
            data: [{ video_id: "video-1", created_at: "2026-04-01T00:00:00Z" }],
            error: null,
          },
        },
      ],
      (id) => {
        if (id === "u1") {
          return { data: { user: { email: "u1@example.com" } }, error: null };
        }
        if (id === "u2") {
          return { data: { user: null }, error: { message: "lookup down" } };
        }
        throw new Error("auth lookup threw");
      },
    );

    const result = await getVideoUsersDisclosure(client, "video-1");

    expect(result).toEqual({
      videoId: "video-1",
      users: [
        {
          userId: "u1",
          email: "u1@example.com",
          emailLookupOk: true,
          accessedAt: "2026-04-05T00:00:00Z",
          cacheHit: true,
        },
        {
          userId: "u2",
          email: null,
          emailLookupOk: false,
          accessedAt: "2026-04-03T00:00:00Z",
          cacheHit: true,
        },
        {
          userId: "u3",
          email: null,
          emailLookupOk: false,
          accessedAt: "2026-04-02T00:00:00Z",
          cacheHit: true,
        },
      ],
      truncated: false,
    });
  });

  it("marks a cap hit and only reveals the capped access rows", async () => {
    const history = Array.from({ length: VIDEO_USERS_DRILLDOWN_CAP + 1 }, () => ({
      user_id: "u1",
      video_id: "video-1",
      created_at: "2026-04-05T00:00:00Z",
    }));
    const client = buildClient(
      [
        {
          table: "user_video_history",
          response: { data: history, error: null },
        },
        {
          table: "summaries",
          response: { data: [], error: null },
        },
      ],
      () => ({ data: { user: { email: null } }, error: null }),
    );

    const result = await getVideoUsersDisclosure(client, "video-1");

    expect(result.truncated).toBe(true);
    expect(result.users).toHaveLength(1);
    expect(result.users[0].cacheHit).toBe(false);
  });

  it("returns an empty disclosure without querying summaries when history is empty", async () => {
    const client = buildClient(
      [{ table: "user_video_history", response: { data: [], error: null } }],
      vi.fn(),
    );

    await expect(getVideoUsersDisclosure(client, "video-1")).resolves.toEqual({
      videoId: "video-1",
      users: [],
      truncated: false,
    });
  });

  it("surfaces history and summary read failures to the action", async () => {
    const historyClient = buildClient(
      [
        {
          table: "user_video_history",
          response: { data: null, error: { message: "history down" } },
        },
      ],
      vi.fn(),
    );
    await expect(getVideoUsersDisclosure(historyClient, "video-1")).rejects.toBeInstanceOf(
      VideoUserDisclosureError,
    );

    const summaryClient = buildClient(
      [
        {
          table: "user_video_history",
          response: {
            data: [
              {
                user_id: "u1",
                video_id: "video-1",
                created_at: "2026-04-05T00:00:00Z",
              },
            ],
            error: null,
          },
        },
        {
          table: "summaries",
          response: { data: null, error: { message: "summaries down" } },
        },
      ],
      vi.fn(),
    );
    await expect(getVideoUsersDisclosure(summaryClient, "video-1")).rejects.toBeInstanceOf(
      VideoUserDisclosureError,
    );
  });
});
