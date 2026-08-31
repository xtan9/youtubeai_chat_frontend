import "server-only";

import type { YouTubeCommentCandidate } from "./contracts";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const YOUTUBE_MODERATION_SCOPE =
  "https://www.googleapis.com/auth/youtube.force-ssl";

export class YouTubeApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`YouTube API request failed (${status}, ${code})`);
    this.name = "YouTubeApiError";
    this.status = status;
    this.code = code;
  }
}

function oauthCredentials() {
  const clientId = process.env.GOOGLE_YOUTUBE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_YOUTUBE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_YOUTUBE_CLIENT_ID and GOOGLE_YOUTUBE_CLIENT_SECRET must be configured",
    );
  }
  return { clientId, clientSecret };
}

export function youtubeOAuthRedirectUri(origin: string): string {
  return (
    process.env.YOUTUBE_OAUTH_REDIRECT_URI?.trim() ||
    `${origin.replace(/\/$/, "")}/api/youtube/oauth/callback`
  );
}

export function buildYouTubeAuthorizationUrl(input: {
  state: string;
  origin: string;
}): string {
  const { clientId } = oauthCredentials();
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", youtubeOAuthRedirectUri(input.origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_MODERATION_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", input.state);
  return url.toString();
}

type TokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
};

async function readTokenResponse(response: Response): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  scopes: string[];
}> {
  const raw = (await response.json().catch(() => null)) as TokenResponse | null;
  if (!response.ok) {
    throw new YouTubeApiError(response.status, "OAUTH_TOKEN_EXCHANGE_FAILED");
  }
  if (
    typeof raw?.access_token !== "string" ||
    typeof raw.expires_in !== "number" ||
    !Number.isFinite(raw.expires_in)
  ) {
    throw new YouTubeApiError(502, "OAUTH_TOKEN_RESPONSE_INVALID");
  }
  return {
    accessToken: raw.access_token,
    refreshToken:
      typeof raw.refresh_token === "string" ? raw.refresh_token : null,
    expiresAt: new Date(Date.now() + raw.expires_in * 1000).toISOString(),
    scopes: typeof raw.scope === "string" ? raw.scope.split(/\s+/) : [],
  };
}

export async function exchangeYouTubeAuthorizationCode(input: {
  code: string;
  origin: string;
}) {
  const { clientId, clientSecret } = oauthCredentials();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: youtubeOAuthRedirectUri(input.origin),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  return readTokenResponse(response);
}

export async function refreshYouTubeAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = oauthCredentials();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  return readTokenResponse(response);
}

function errorCode(raw: unknown): string {
  const reason = (
    raw as { error?: { errors?: Array<{ reason?: unknown }> } }
  )?.error?.errors?.[0]?.reason;
  return typeof reason === "string" && reason.length <= 80
    ? reason
    : "YOUTUBE_API_ERROR";
}

async function youtubeFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${YOUTUBE_API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  const raw = await response.json().catch(() => null);
  if (!response.ok) {
    throw new YouTubeApiError(response.status, errorCode(raw));
  }
  return raw as T;
}

export async function fetchAuthenticatedYouTubeChannel(
  accessToken: string,
): Promise<{ id: string; title: string }> {
  const response = await youtubeFetch<{
    items?: Array<{ id?: unknown; snippet?: { title?: unknown } }>;
  }>("/channels?part=snippet&mine=true&maxResults=1", accessToken);
  const channel = response.items?.[0];
  if (
    typeof channel?.id !== "string" ||
    typeof channel.snippet?.title !== "string"
  ) {
    throw new YouTubeApiError(404, "YOUTUBE_CHANNEL_NOT_FOUND");
  }
  return { id: channel.id, title: channel.snippet.title };
}

type RawComment = {
  id?: unknown;
  snippet?: {
    authorChannelId?: unknown;
    authorDisplayName?: unknown;
    textDisplay?: unknown;
    textOriginal?: unknown;
    parentId?: unknown;
    videoId?: unknown;
    publishedAt?: unknown;
  };
};

type RawThread = {
  snippet?: {
    topLevelComment?: RawComment;
    totalReplyCount?: unknown;
  };
  replies?: { comments?: RawComment[] };
};

function authorChannelId(value: unknown): string | null {
  if (typeof value === "string") return value;
  const nested = (value as { value?: unknown } | null)?.value;
  return typeof nested === "string" ? nested : null;
}

function candidateFromComment(
  comment: RawComment,
  fallbackParentId?: string,
  fallbackVideoId?: string,
): YouTubeCommentCandidate | null {
  const snippet = comment.snippet;
  const text =
    typeof snippet?.textOriginal === "string"
      ? snippet.textOriginal
      : typeof snippet?.textDisplay === "string"
        ? snippet.textDisplay
        : null;
  const parentId =
    typeof snippet?.parentId === "string"
      ? snippet.parentId
      : fallbackParentId;
  const videoId =
    typeof snippet?.videoId === "string" ? snippet.videoId : fallbackVideoId;
  if (
    typeof comment.id !== "string" ||
    typeof parentId !== "string" ||
    typeof videoId !== "string" ||
    typeof snippet?.authorDisplayName !== "string" ||
    !text
  ) {
    return null;
  }
  return {
    commentId: comment.id,
    parentCommentId: parentId,
    videoId,
    authorChannelId: authorChannelId(snippet.authorChannelId),
    authorDisplayName: snippet.authorDisplayName,
    text: text.slice(0, 5000),
    publishedAt:
      typeof snippet.publishedAt === "string" ? snippet.publishedAt : null,
  };
}

async function listCommentThreadPage(
  accessToken: string,
  filter: { channelId: string } | { videoId: string },
  pageToken?: string,
): Promise<{ items: RawThread[]; nextPageToken: string | null }> {
  const query = new URLSearchParams({
    part: "snippet,replies",
    maxResults: "100",
    order: "time",
    textFormat: "plainText",
    ...(filter && "channelId" in filter
      ? { allThreadsRelatedToChannelId: filter.channelId }
      : { videoId: filter.videoId }),
  });
  if (pageToken) query.set("pageToken", pageToken);
  const response = await youtubeFetch<{
    items?: RawThread[];
    nextPageToken?: unknown;
  }>(
    `/commentThreads?${query}`,
    accessToken,
  );
  return {
    items: response.items ?? [],
    nextPageToken:
      typeof response.nextPageToken === "string"
        ? response.nextPageToken
        : null,
  };
}

async function listReplies(
  accessToken: string,
  parentId: string,
  videoId: string,
): Promise<YouTubeCommentCandidate[]> {
  const query = new URLSearchParams({
    part: "snippet",
    parentId,
    maxResults: "100",
    textFormat: "plainText",
  });
  const response = await youtubeFetch<{ items?: RawComment[] }>(
    `/comments?${query}`,
    accessToken,
  );
  return (response.items ?? [])
    .map((comment) => candidateFromComment(comment, parentId, videoId))
    .filter((candidate): candidate is YouTubeCommentCandidate => !!candidate);
}

export async function listCreatorCommentCandidates(input: {
  accessToken: string;
  channelId: string;
  limit?: number;
}): Promise<YouTubeCommentCandidate[]> {
  const { items: threads } = await listCommentThreadPage(
    input.accessToken,
    { channelId: input.channelId },
  );
  const candidates: YouTubeCommentCandidate[] = [];
  for (const thread of threads) {
    const top = thread.snippet?.topLevelComment;
    const topId = typeof top?.id === "string" ? top.id : null;
    const topVideoId =
      typeof top?.snippet?.videoId === "string" ? top.snippet.videoId : null;
    if (!top || !topId || !topVideoId) continue;
    const topCandidate = candidateFromComment(top, topId, topVideoId);
    if (topCandidate?.authorChannelId !== input.channelId) {
      if (topCandidate) candidates.push(topCandidate);
    }
    for (const reply of thread.replies?.comments ?? []) {
      const candidate = candidateFromComment(reply, topId, topVideoId);
      if (candidate && candidate.authorChannelId !== input.channelId) {
        candidates.push(candidate);
      }
    }
    if (candidates.length >= (input.limit ?? 20)) break;
  }
  return candidates.slice(0, input.limit ?? 20);
}

export async function listConsumerReplyCandidates(input: {
  accessToken: string;
  channelId: string;
  videoId: string;
  limit?: number;
}): Promise<YouTubeCommentCandidate[]> {
  const ownThreads: RawThread[] = [];
  let pageToken: string | undefined;
  // A viewer's comment may not be among a busy video's first 100 threads.
  // Bound pagination to five quota units and ten owned threads so a manual
  // scan stays predictable while covering substantially older comments.
  for (let page = 0; page < 5 && ownThreads.length < 10; page++) {
    const result = await listCommentThreadPage(
      input.accessToken,
      { videoId: input.videoId },
      pageToken,
    );
    ownThreads.push(
      ...result.items.filter((thread) => {
        const top = thread.snippet?.topLevelComment;
        return (
          authorChannelId(top?.snippet?.authorChannelId) === input.channelId
        );
      }),
    );
    if (!result.nextPageToken) break;
    pageToken = result.nextPageToken;
  }
  const replies = await Promise.all(
    ownThreads.slice(0, 10).map(async (thread) => {
      const top = thread.snippet?.topLevelComment;
      if (typeof top?.id !== "string") return [];
      return listReplies(input.accessToken, top.id, input.videoId);
    }),
  );
  return replies
    .flat()
    .filter((candidate) => candidate.authorChannelId !== input.channelId)
    .slice(0, input.limit ?? 20);
}

export async function publishYouTubeReply(input: {
  accessToken: string;
  parentCommentId: string;
  text: string;
}): Promise<string> {
  const response = await youtubeFetch<{ id?: unknown }>(
    "/comments?part=snippet",
    input.accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        snippet: {
          parentId: input.parentCommentId,
          textOriginal: input.text.slice(0, 9500),
        },
      }),
    },
  );
  if (typeof response.id !== "string") {
    throw new YouTubeApiError(502, "YOUTUBE_REPLY_RESPONSE_INVALID");
  }
  return response.id;
}

export async function revokeGoogleToken(token: string): Promise<void> {
  await fetch(
    `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      cache: "no-store",
    },
  ).catch(() => undefined);
}
