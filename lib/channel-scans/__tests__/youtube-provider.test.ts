import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { YouTubeComplianceClearance } from "@/lib/compliance/youtube-channel-clearance";
import {
  createYouTubeCommentProvider,
  type YouTubeScanTarget,
} from "../youtube-provider";

const TARGET: YouTubeScanTarget = {
  accountId: "account-1",
  channelId: "00000000-0000-4000-8000-000000000002",
  connectedChannelId: "00000000-0000-4000-8000-000000000001",
  grantId: "00000000-0000-4000-8000-000000000003",
  providerSubject: "oauth-subject-1",
  providerChannelId: "UCverifiedcreator",
  displayName: "Supported Creator",
  identityVerified: true,
  supportedCreator: true,
  readScopeGranted: true,
  status: "active",
};

const PERMITTED_CLEARANCE: YouTubeComplianceClearance = {
  recordType: "youtube-channel-comment-assistance-compliance-clearance",
  recordVersion: 1,
  issueNumber: 470,
  sourceSpec: {
    path: "docs/specs/2026-08-31-comment-assistance-discovery.md",
    url: "https://github.com/xtan9/youtubeai_chat_frontend/blob/main/docs/specs/2026-08-31-comment-assistance-discovery.md",
  },
  decision: "permitted",
  packet: {
    issueNumber: 469,
    status: "reviewed",
    artifactPath:
      "docs/compliance/youtube-channel-comment-assistance-audit-packet.md",
    revision: "test-fixture",
    reviewedAt: "2026-09-01",
    reviewedBy: "test fixture",
  },
  determination: {
    responseDate: "2026-09-01",
    reviewerOrAuthority: "test fixture",
    applicablePolicies: ["test policy"],
    permittedScope: "test scope",
    prohibitedScope: "test prohibited scope",
    sourceReference: "test://clearance",
    verbatimResponse: "test determination",
  },
  coverage: {
    customPerCommentBehavioralAssessment: true,
    modelProviderFlow: true,
    retentionApproach: true,
  },
  conditions: [],
};

const WINDOW_START = new Date("2026-08-25T00:00:00.000Z");
const WINDOW_END = new Date("2026-09-01T00:00:00.000Z");

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function publicThread(overrides: Record<string, unknown> = {}) {
  return {
    id: "thread-1",
    snippet: {
      isPublic: true,
      videoId: "AbCdEfGhI_1",
      topLevelComment: {
        id: "comment-1",
        snippet: {
          authorChannelId: { value: "UCcommentauthor" },
          authorDisplayName: "Private Comment Author",
          textDisplay: "Supported Creator, you are a fool.",
          publishedAt: "2026-08-31T12:00:00.000Z",
          updatedAt: "2026-08-31T12:00:00.000Z",
          moderationStatus: "published",
        },
      },
    },
    replies: {
      comments: [
        {
          id: "reply-1",
          snippet: {
            authorChannelId: { value: TARGET.providerChannelId },
            authorDisplayName: "Private Steward Name",
            textDisplay: "Thanks for watching.",
            publishedAt: "2026-08-31T12:01:00.000Z",
            updatedAt: "2026-08-31T12:01:00.000Z",
            moderationStatus: "published",
            parentId: "comment-1",
          },
        },
      ],
    },
    ...overrides,
  };
}

describe("YouTubeCommentProvider", () => {
  it("uses the API key for published public threads and strips identities before assessment", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({
        kind: "youtube#commentThreadListResponse",
        nextPageToken: "page-2",
        items: [
          publicThread(),
          publicThread({
            id: "held-thread",
            snippet: {
              isPublic: false,
              videoId: "AbCdEfGhI_2",
              topLevelComment: {
                id: "held-comment",
                snippet: {
                  authorDisplayName: "Held Author",
                  textDisplay: "held text",
                  publishedAt: "2026-08-31T11:00:00.000Z",
                  moderationStatus: "heldForReview",
                },
              },
            },
          }),
          publicThread({
            id: "spam-thread",
            snippet: {
              isPublic: true,
              videoId: "AbCdEfGhI_3",
              topLevelComment: {
                id: "spam-comment",
                snippet: {
                  authorDisplayName: "Spam Author",
                  textDisplay: "spam text",
                  publishedAt: "2026-08-31T10:00:00.000Z",
                  moderationStatus: "likelySpam",
                },
              },
            },
          }),
        ],
      }),
    );
    const provider = createYouTubeCommentProvider({
      apiKey: "api-key-fixture",
      target: TARGET,
      compliance: PERMITTED_CLEARANCE,
      fetchImpl,
      videoTitleFor: vi.fn().mockResolvedValue("A governed video"),
    });

    const page = await provider.listTopLevelThreads({
      connectedChannelId: TARGET.connectedChannelId,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      pageToken: null,
      pageSize: 50,
    });

    expect(page.threads).toHaveLength(1);
    expect(page.threads[0]).toMatchObject({
      threadId: "thread-1",
      commentId: "comment-1",
      videoId: "AbCdEfGhI_1",
      content: "Supported Creator, you are a fool.",
      isTopLevel: true,
    });
    expect(page.nextPageToken).toBe("page-2");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const requestUrl = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(requestUrl.origin + requestUrl.pathname).toBe(
      "https://www.googleapis.com/youtube/v3/commentThreads",
    );
    expect(requestUrl.searchParams.get("key")).toBe("api-key-fixture");
    expect(requestUrl.searchParams.get("allThreadsRelatedToChannelId")).toBe(
      TARGET.providerChannelId,
    );
    expect(requestUrl.searchParams.get("order")).toBe("time");
    expect(requestUrl.searchParams.get("moderationStatus")).toBeNull();
    expect(fetchImpl.mock.calls[0][1]).not.toMatchObject({
      headers: expect.objectContaining({ Authorization: expect.anything() }),
    });
    expect(JSON.stringify(page.threads)).not.toContain("Private Comment Author");
    expect(JSON.stringify(page.threads)).not.toContain("UCcommentauthor");
    expect(JSON.stringify(page.threads)).not.toContain("Private Steward Name");
    expect(JSON.stringify(page.threads)).not.toContain(TARGET.providerChannelId);
  });

  it("fails closed before transport when compliance, target, or API configuration is unavailable", async () => {
    const fetchImpl = vi.fn();
    const provider = createYouTubeCommentProvider({
      apiKey: "api-key-fixture",
      target: TARGET,
      fetchImpl,
    });

    await expect(
      provider.listTopLevelThreads({
        connectedChannelId: TARGET.connectedChannelId,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        pageToken: null,
        pageSize: 50,
      }),
    ).rejects.toMatchObject({ code: "YOUTUBE_ASSESSMENT_GATE_BLOCKED" });
    expect(fetchImpl).not.toHaveBeenCalled();

    const missingTarget = createYouTubeCommentProvider({
      apiKey: "api-key-fixture",
      compliance: PERMITTED_CLEARANCE,
      fetchImpl,
    });
    await expect(
      missingTarget.listTopLevelThreads({
        connectedChannelId: TARGET.connectedChannelId,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        pageToken: null,
        pageSize: 50,
      }),
    ).rejects.toMatchObject({ code: "YOUTUBE_SCAN_TARGET_UNAVAILABLE" });
    expect(fetchImpl).not.toHaveBeenCalled();

    const missingKey = createYouTubeCommentProvider({
      target: TARGET,
      compliance: PERMITTED_CLEARANCE,
      fetchImpl,
    });
    await expect(
      missingKey.listTopLevelThreads({
        connectedChannelId: TARGET.connectedChannelId,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        pageToken: null,
        pageSize: 50,
      }),
    ).rejects.toMatchObject({ code: "YOUTUBE_API_KEY_UNAVAILABLE" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("normalizes shared YouTube quota exhaustion without falling back", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response(
        {
          error: {
            errors: [{ reason: "quotaExceeded" }],
          },
        },
        403,
      ),
    );
    const provider = createYouTubeCommentProvider({
      apiKey: "api-key-fixture",
      target: TARGET,
      compliance: PERMITTED_CLEARANCE,
      fetchImpl,
    });

    await expect(
      provider.listTopLevelThreads({
        connectedChannelId: TARGET.connectedChannelId,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        pageToken: null,
        pageSize: 50,
      }),
    ).rejects.toMatchObject({ code: "YOUTUBE_QUOTA_EXHAUSTED" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("re-fetches the current thread before assessment and exposes only anonymous context", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({ items: [publicThread()] }),
    );
    const assessInteraction = vi.fn().mockResolvedValue({
      schemaVersion: "interaction-assessment-v1" as const,
      category: "reviewable_interaction" as const,
      language: "english" as const,
      target: "channel_steward" as const,
      targetEvidence: ["channel_or_steward_identity" as const],
      draftEligible: false,
    });
    const provider = createYouTubeCommentProvider({
      apiKey: "api-key-fixture",
      target: TARGET,
      compliance: PERMITTED_CLEARANCE,
      fetchImpl,
      videoTitleFor: vi.fn().mockResolvedValue("A governed video"),
      assessInteraction,
    });

    const current = await provider.findThread({
      connectedChannelId: TARGET.connectedChannelId,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      threadId: "thread-1",
      contentHash: "old-hash-that-must-not-be-trusted",
    });

    expect(current).toMatchObject({
      threadId: "thread-1",
      commentId: "comment-1",
      assessmentContext: { videoTitle: "A governed video" },
    });
    expect(current?.contentHash).not.toBe("old-hash-that-must-not-be-trusted");
    const assessment = await provider.assess(current!);
    expect(assessInteraction).toHaveBeenCalledOnce();
    expect(JSON.stringify(assessment)).not.toContain("Private Comment Author");
    expect(JSON.stringify(assessment)).not.toContain("Private Steward Name");
    expect(JSON.stringify(assessment)).not.toContain(TARGET.providerChannelId);
    const requestUrl = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(requestUrl.searchParams.get("id")).toBe("thread-1");
    expect(requestUrl.searchParams.get("allThreadsRelatedToChannelId")).toBeNull();
  });

  it("verifies an owned Video before using the mutually exclusive video filter", async () => {
    const videoId = "AbCdEfGhI_1";
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          items: [
            {
              id: videoId,
              snippet: {
                channelId: TARGET.providerChannelId,
                title: "An owned video",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(response({ items: [] }));
    const provider = createYouTubeCommentProvider({
      apiKey: "api-key-fixture",
      target: TARGET,
      compliance: PERMITTED_CLEARANCE,
      fetchImpl,
    });

    await provider.validateOwnedVideo({
      connectedChannelId: TARGET.connectedChannelId,
      videoId,
    });
    await provider.listTopLevelThreads({
      connectedChannelId: TARGET.connectedChannelId,
      videoId,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      pageToken: null,
      pageSize: 50,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const requestUrl = new URL(fetchImpl.mock.calls[1][0] as string);
    expect(requestUrl.searchParams.get("videoId")).toBe(videoId);
    expect(requestUrl.searchParams.get("allThreadsRelatedToChannelId")).toBeNull();
  });

  it("rejects a Video that is not owned by the verified Channel", async () => {
    const videoId = "AbCdEfGhI_2";
    const fetchImpl = vi.fn().mockResolvedValue(
      response({
        items: [
          {
            id: videoId,
            snippet: {
              channelId: "UCanothercreator",
              title: "Another creator's video",
            },
          },
        ],
      }),
    );
    const provider = createYouTubeCommentProvider({
      apiKey: "api-key-fixture",
      target: TARGET,
      compliance: PERMITTED_CLEARANCE,
      fetchImpl,
    });

    await expect(
      provider.validateOwnedVideo({
        connectedChannelId: TARGET.connectedChannelId,
        videoId,
      }),
    ).rejects.toMatchObject({ code: "YOUTUBE_VIDEO_SCOPE_MISMATCH" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps sensitive comment and title evidence masked before assessment", async () => {
    const sensitive =
      "Email steward@example.com or call +1 (415) 555-2671 at 123 Main Street.";
    const fetchImpl = vi.fn().mockResolvedValue(
      response({
        items: [
          publicThread({
            snippet: {
              isPublic: true,
              videoId: "AbCdEfGhI_1",
              topLevelComment: {
                id: "comment-1",
                snippet: {
                  authorChannelId: { value: "UCcommentauthor" },
                  textDisplay: sensitive,
                  publishedAt: "2026-08-31T12:00:00.000Z",
                  moderationStatus: "published",
                },
              },
            },
          }),
        ],
      }),
    );
    const provider = createYouTubeCommentProvider({
      apiKey: "api-key-fixture",
      target: TARGET,
      compliance: PERMITTED_CLEARANCE,
      fetchImpl,
      videoTitleFor: vi.fn().mockResolvedValue(sensitive),
      assessInteraction: vi.fn().mockResolvedValue({
        schemaVersion: "interaction-assessment-v1" as const,
        category: "safety_flag" as const,
        language: "english" as const,
        target: "ambiguous" as const,
        targetEvidence: [],
        draftEligible: false,
      }),
    });

    const current = await provider.findThread({
      connectedChannelId: TARGET.connectedChannelId,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      threadId: "thread-1",
      contentHash: "old-hash",
    });
    const assessment = await provider.assess(current!);

    expect(JSON.stringify(current)).not.toContain("steward@example.com");
    expect(JSON.stringify(current)).not.toContain("+1 (415) 555-2671");
    expect(JSON.stringify(current)).not.toContain("123 Main Street");
    expect(JSON.stringify(assessment)).not.toContain("steward@example.com");
    expect(JSON.stringify(assessment)).not.toContain("+1 (415) 555-2671");
    expect(JSON.stringify(assessment)).not.toContain("123 Main Street");
  });
});
