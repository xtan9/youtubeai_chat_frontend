import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  listConsumerReplyCandidates,
  listCreatorCommentCandidates,
  publishYouTubeReply,
} from "../youtube-api";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const comment = (input: {
  id: string;
  author: string;
  text: string;
  videoId?: string;
  parentId?: string;
}) => ({
  id: input.id,
  snippet: {
    authorChannelId: { value: input.author },
    authorDisplayName: input.author,
    textOriginal: input.text,
    videoId: input.videoId,
    parentId: input.parentId,
    publishedAt: "2026-08-31T12:00:00Z",
  },
});

afterEach(() => vi.restoreAllMocks());

describe("YouTube comment API mapping", () => {
  it("does not classify the creator's own comments or replies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            {
              snippet: {
                topLevelComment: comment({
                  id: "top-1",
                  author: "viewer",
                  text: "top-level attack",
                  videoId: "abcdefghijk",
                }),
              },
              replies: {
                comments: [
                  comment({
                    id: "reply-own",
                    author: "creator",
                    text: "creator response",
                    videoId: "abcdefghijk",
                    parentId: "top-1",
                  }),
                  comment({
                    id: "reply-viewer",
                    author: "viewer-2",
                    text: "another attack",
                    videoId: "abcdefghijk",
                    parentId: "top-1",
                  }),
                ],
              },
            },
          ],
        }),
      ),
    );

    const result = await listCreatorCommentCandidates({
      accessToken: "token",
      channelId: "creator",
    });
    expect(result.map((item) => item.commentId)).toEqual([
      "top-1",
      "reply-viewer",
    ]);
  });

  it("finds replies only under the consumer's own top-level comments", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              snippet: {
                topLevelComment: comment({
                  id: "mine",
                  author: "consumer",
                  text: "my comment",
                  videoId: "abcdefghijk",
                }),
              },
            },
            {
              snippet: {
                topLevelComment: comment({
                  id: "theirs",
                  author: "someone-else",
                  text: "not mine",
                  videoId: "abcdefghijk",
                }),
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            comment({
              id: "reply-to-mine",
              author: "troll",
              text: "reply text",
              videoId: "abcdefghijk",
              parentId: "mine",
            }),
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listConsumerReplyCandidates({
      accessToken: "token",
      channelId: "consumer",
      videoId: "abcdefghijk",
    });
    expect(result.map((item) => item.commentId)).toEqual(["reply-to-mine"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("paginates busy videos to find an older consumer comment", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          nextPageToken: "page-2",
          items: [
            {
              snippet: {
                topLevelComment: comment({
                  id: "newer-comment",
                  author: "someone-else",
                  text: "newer",
                  videoId: "abcdefghijk",
                }),
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              snippet: {
                topLevelComment: comment({
                  id: "older-mine",
                  author: "consumer",
                  text: "older comment",
                  videoId: "abcdefghijk",
                }),
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            comment({
              id: "reply-to-older",
              author: "troll",
              text: "reply text",
              videoId: "abcdefghijk",
              parentId: "older-mine",
            }),
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listConsumerReplyCandidates({
      accessToken: "token",
      channelId: "consumer",
      videoId: "abcdefghijk",
    });
    expect(result.map((item) => item.commentId)).toEqual(["reply-to-older"]);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("pageToken=page-2");
  });

  it("posts a reply to the top-level parent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "new-reply" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      publishYouTubeReply({
        accessToken: "token",
        parentCommentId: "top-1",
        text: "Keep this focused on the topic.",
      }),
    ).resolves.toBe("new-reply");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      snippet: {
        parentId: "top-1",
        textOriginal: "Keep this focused on the topic.",
      },
    });
  });
});
