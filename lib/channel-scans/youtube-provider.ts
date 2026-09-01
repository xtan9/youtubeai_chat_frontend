import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CURRENT_YOUTUBE_CHANNEL_COMPLIANCE_CLEARANCE,
  evaluateYouTubeChannelAssessmentGate,
  type YouTubeComplianceClearance,
} from "@/lib/compliance/youtube-channel-clearance";
import {
  buildAssessmentContext,
  MAX_NEIGHBORING_REPLIES,
  type AssessmentContext,
  type AssessmentRole,
  type FinalizedInteractionAssessment,
  type InteractionCommentSnapshot,
  type TargetEvidence,
} from "@/lib/channel/interaction-assessment";
import { maskSensitiveEvidence } from "@/lib/channel/sensitive-evidence";
import {
  SCAN_PAGE_SIZE,
  YOUTUBE_SCAN_PROVIDER,
  youtubeVideoIdSchema,
} from "./contracts";
import type {
  InteractionAssessmentEvaluation,
  ScanCommentProvider,
  ScanProviderPage,
  ScanProviderThread,
} from "./provider";

export const YOUTUBE_DATA_API_BASE_URL =
  "https://www.googleapis.com/youtube/v3" as const;
export const YOUTUBE_API_KEY_ENV = "YOUTUBE_DATA_API_KEY" as const;
export const YOUTUBE_READ_REQUEST_TIMEOUT_MS = 30_000;
export const MAX_YOUTUBE_RESPONSE_CHARS = 2_000_000;

const MAX_PROVIDER_ID_CHARS = 240;
const MAX_SCAN_ID_CHARS = 200;
const MAX_PAGE_TOKEN_CHARS = 200;
const MAX_DISPLAY_NAME_CHARS = 240;
const MAX_COMMENT_SOURCE_CHARS = 2_000;
const YOUTUBE_QUOTA_REASONS = new Set([
  "quotaExceeded",
  "dailyLimitExceeded",
  "rateLimitExceeded",
  "userRateLimitExceeded",
]);

export const YouTubeScanTargetSchema = z
  .object({
    accountId: z.string().trim().min(1).max(MAX_PROVIDER_ID_CHARS),
    channelId: z.string().trim().min(1).max(MAX_PROVIDER_ID_CHARS),
    connectedChannelId: z.string().trim().min(1).max(MAX_PROVIDER_ID_CHARS),
    grantId: z.string().trim().min(1).max(MAX_PROVIDER_ID_CHARS),
    providerSubject: z.string().trim().min(1).max(MAX_PROVIDER_ID_CHARS),
    providerChannelId: z.string().trim().min(1).max(MAX_PROVIDER_ID_CHARS),
    displayName: z.string().trim().min(1).max(MAX_DISPLAY_NAME_CHARS),
    identityVerified: z.literal(true),
    supportedCreator: z.literal(true),
    readScopeGranted: z.literal(true),
    status: z.literal("active"),
  })
  .strict();

export type YouTubeScanTarget = z.infer<typeof YouTubeScanTargetSchema>;

export type YouTubeProviderBlockedCode =
  | "YOUTUBE_ASSESSMENT_GATE_BLOCKED"
  | "YOUTUBE_SCAN_TARGET_UNAVAILABLE"
  | "YOUTUBE_SCAN_TARGET_MISMATCH"
  | "YOUTUBE_API_KEY_UNAVAILABLE"
  | "YOUTUBE_VIDEO_SCOPE_UNAVAILABLE";

export type YouTubeProviderErrorCode =
  | YouTubeProviderBlockedCode
  | "YOUTUBE_PROVIDER_UNAVAILABLE"
  | "YOUTUBE_RESPONSE_INVALID"
  | "YOUTUBE_QUOTA_EXHAUSTED"
  | "YOUTUBE_AUTHORIZATION_FAILED"
  | "YOUTUBE_API_FAILED"
  | "YOUTUBE_COMMENT_NOT_FOUND"
  | "YOUTUBE_VIDEO_TITLE_UNAVAILABLE"
  | "YOUTUBE_VIDEO_UNAVAILABLE"
  | "YOUTUBE_VIDEO_SCOPE_MISMATCH"
  | "YOUTUBE_ASSESSMENT_PROVIDER_UNAVAILABLE"
  | "YOUTUBE_ASSESSMENT_CONTEXT_UNAVAILABLE";

export class YouTubeCommentProviderError extends Error {
  readonly code: YouTubeProviderErrorCode;

  constructor(code: YouTubeProviderErrorCode, message: string) {
    super(message);
    this.name = "YouTubeCommentProviderError";
    this.code = code;
  }
}

export type YouTubeProviderReadiness =
  | Readonly<{ ready: true }>
  | Readonly<{
      ready: false;
      code: YouTubeProviderBlockedCode;
      reason: string;
    }>;

export type YouTubeProviderOptions = Readonly<{
  /** Supplied by server configuration; it is never returned or logged. */
  apiKey?: string;
  /** Must come from the account-owned, provider-verified onboarding record. */
  target?: YouTubeScanTarget | null;
  /** Defaults to the checked-in external-clearance record. */
  compliance?: YouTubeComplianceClearance | unknown;
  /** Dependency seam for tests and separately governed execution. */
  fetchImpl?: typeof fetch;
  /** The video title is fetched separately because commentThreads omits it. */
  videoTitleFor?: (videoId: string) => Promise<string | null>;
  /** Assessment is a separate structured call from the read adapter. */
  assessInteraction?: (
    context: AssessmentContext,
  ) => Promise<FinalizedInteractionAssessment>;
}>;

export type YouTubeCommentProvider = ScanCommentProvider &
  Readonly<{
    readonly kind: typeof YOUTUBE_SCAN_PROVIDER;
    readonly readiness: YouTubeProviderReadiness;
    validateOwnedVideo(input: {
      connectedChannelId: string;
      videoId: string;
    }): Promise<void>;
  }>;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function nonEmptyText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return [...normalized].slice(0, maximum).join("");
}

function fullSourceText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function boundedText(value: string, maximum: number): string {
  return [...value].slice(0, maximum).join("");
}

function boundedIdentifier(value: unknown, maximum: number): string | null {
  const normalized = fullSourceText(value);
  if (!normalized || [...normalized].length > maximum) return null;
  return normalized;
}

function property(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function sourceCommentText(comment: unknown): string | null {
  const snippet = property(comment, "snippet");
  return (
    fullSourceText(property(snippet, "textOriginal")) ??
    fullSourceText(property(snippet, "textDisplay"))
  );
}

function authorChannelId(comment: unknown): string | null {
  const value = property(property(comment, "snippet"), "authorChannelId");
  return boundedIdentifier(property(value, "value"), MAX_SCAN_ID_CHARS);
}

function moderationStatus(comment: unknown): string | null {
  return nonEmptyText(
    property(property(comment, "snippet"), "moderationStatus"),
    40,
  );
}

function isPublishedPublicThread(item: unknown): boolean {
  const snippet = property(item, "snippet");
  if (property(snippet, "isPublic") !== true) return false;
  const topLevelComment = property(snippet, "topLevelComment");
  const topLevelPublic = property(
    property(topLevelComment, "snippet"),
    "isPublic",
  );
  if (topLevelPublic !== undefined && topLevelPublic !== true) return false;
  const status = moderationStatus(topLevelComment);
  return status === null || status === "published";
}

function isPublishedReply(comment: unknown): boolean {
  const isPublic = property(property(comment, "snippet"), "isPublic");
  if (isPublic !== undefined && isPublic !== true) return false;
  const status = moderationStatus(comment);
  return status === null || status === "published";
}

function commentId(comment: unknown): string | null {
  return boundedIdentifier(property(comment, "id"), MAX_SCAN_ID_CHARS);
}

function threadId(item: unknown): string | null {
  return boundedIdentifier(property(item, "id"), MAX_SCAN_ID_CHARS);
}

function videoId(item: unknown): string | null {
  return boundedIdentifier(
    property(property(item, "snippet"), "videoId"),
    MAX_SCAN_ID_CHARS,
  );
}

function publishedAt(comment: unknown): string | null {
  const value = nonEmptyText(
    property(property(comment, "snippet"), "publishedAt"),
    80,
  );
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function roleFor(comment: unknown, target: YouTubeScanTarget): AssessmentRole {
  const channelId = authorChannelId(comment);
  if (!channelId) return "unknown";
  return channelId === target.providerChannelId
    ? "channel_steward"
    : "other_participant";
}

function targetEvidenceFor(
  text: string,
  target: YouTubeScanTarget,
): readonly TargetEvidence[] {
  const displayName = target.displayName.trim().toLocaleLowerCase();
  if (
    displayName.length < 2 ||
    !text.toLocaleLowerCase().includes(displayName)
  ) {
    return [];
  }
  return ["channel_or_steward_identity"];
}

function snapshotFor(
  comment: unknown,
  target: YouTubeScanTarget,
  text: string,
  evidenceText = text,
): InteractionCommentSnapshot | null {
  const id = commentId(comment);
  if (!id) return null;
  return {
    commentId: id,
    text,
    authorRole: roleFor(comment, target),
    observableTargetEvidence: targetEvidenceFor(evidenceText, target),
    languageHint: null,
  };
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function modelSafeText(text: string): string {
  return maskSensitiveEvidence(text).maskedText;
}

function contextFor(
  item: unknown,
  target: YouTubeScanTarget,
  text: string,
  videoTitle: string,
): AssessmentContext | null {
  const snippet = property(item, "snippet");
  const topLevelComment = property(snippet, "topLevelComment");
  const candidate = snapshotFor(
    topLevelComment,
    target,
    modelSafeText(text),
    text,
  );
  if (!candidate) return null;

  const replies = property(property(item, "replies"), "comments");
  const neighboringReplies = Array.isArray(replies)
    ? replies
        .slice(0, MAX_NEIGHBORING_REPLIES)
        .filter(isPublishedReply)
        .map((reply) => {
          const replyText = sourceCommentText(reply);
          return replyText
            ? snapshotFor(reply, target, modelSafeText(replyText), replyText)
            : null;
        })
        .filter((reply): reply is InteractionCommentSnapshot => reply !== null)
    : [];

  return buildAssessmentContext({
    videoTitle: modelSafeText(videoTitle),
    candidate,
    topLevelComment: candidate,
    neighboringReplies,
  });
}

function normalizedThreadFor(
  item: unknown,
): ScanProviderThread | null {
  if (!isPublishedPublicThread(item)) return null;
  const topLevelComment = property(property(item, "snippet"), "topLevelComment");
  const id = threadId(item);
  const comment = commentId(topLevelComment);
  const video = youtubeVideoIdSchema.safeParse(videoId(item));
  const text = sourceCommentText(topLevelComment);
  const observedAt = publishedAt(topLevelComment);
  if (!id || !comment || !video.success || !text || !observedAt) return null;

  return {
    threadId: id,
    commentId: comment,
    videoId: video.data,
    publishedAt: observedAt,
    content: boundedText(modelSafeText(text), MAX_COMMENT_SOURCE_CHARS),
    contentHash: hashText(text),
    isTopLevel: true,
    // Context is deliberately built only during revalidation, after the
    // durable page has accepted the metadata. This keeps raw provider data
    // out of the Scan Run store.
  };
}

function boundedPageSize(value: number): number {
  if (!Number.isFinite(value)) return SCAN_PAGE_SIZE;
  return Math.min(SCAN_PAGE_SIZE, Math.max(1, Math.floor(value)));
}

function readApiKey(options: YouTubeProviderOptions): string | null {
  return options.apiKey?.trim() || process.env[YOUTUBE_API_KEY_ENV]?.trim() || null;
}

export function inspectYouTubeCommentProvider(
  options: Pick<YouTubeProviderOptions, "apiKey" | "target" | "compliance"> = {},
): YouTubeProviderReadiness {
  const gate = evaluateYouTubeChannelAssessmentGate(
    options.compliance ?? CURRENT_YOUTUBE_CHANNEL_COMPLIANCE_CLEARANCE,
  );
  if (gate.status === "blocked") {
    return {
      ready: false,
      code: "YOUTUBE_ASSESSMENT_GATE_BLOCKED",
      reason: gate.reason,
    };
  }

  const target = YouTubeScanTargetSchema.safeParse(options.target);
  if (!target.success) {
    return {
      ready: false,
      code: "YOUTUBE_SCAN_TARGET_UNAVAILABLE",
      reason:
        "A provider-verified Supported Creator Channel target is required.",
    };
  }

  if (!readApiKey(options)) {
    return {
      ready: false,
      code: "YOUTUBE_API_KEY_UNAVAILABLE",
      reason: "The server-side YouTube Data API key is not configured.",
    };
  }

  return { ready: true };
}

function blockedError(readiness: YouTubeProviderReadiness): never {
  if (readiness.ready) {
    throw new Error("Expected a blocked YouTube provider readiness result");
  }
  throw new YouTubeCommentProviderError(readiness.code, readiness.reason);
}

function assertConnectedTarget(
  target: YouTubeScanTarget,
  connectedChannelId: string,
): void {
  if (connectedChannelId !== target.connectedChannelId) {
    throw new YouTubeCommentProviderError(
      "YOUTUBE_SCAN_TARGET_MISMATCH",
      "The requested Connected Channel does not match the verified scan target.",
    );
  }
}

function apiReason(body: unknown): string | null {
  const errors = property(property(body, "error"), "errors");
  if (!Array.isArray(errors)) return null;
  for (const error of errors) {
    const reason = nonEmptyText(property(error, "reason"), 80);
    if (reason) return reason;
  }
  return null;
}

function apiStatus(body: unknown): string | null {
  return nonEmptyText(property(property(body, "error"), "status"), 80);
}

function oversizedResponseError(): YouTubeCommentProviderError {
  return new YouTubeCommentProviderError(
    "YOUTUBE_RESPONSE_INVALID",
    "The YouTube read provider response exceeded its safety bound.",
  );
}

async function responseTextWithinLimit(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength) {
    const bytes = Number(declaredLength);
    if (Number.isFinite(bytes) && bytes > MAX_YOUTUBE_RESPONSE_CHARS) {
      throw oversizedResponseError();
    }
  }

  if (!response.body) {
    const raw = await response.text();
    if (raw.length > MAX_YOUTUBE_RESPONSE_CHARS) {
      throw oversizedResponseError();
    }
    return raw;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_YOUTUBE_RESPONSE_CHARS) {
        await reader.cancel();
        throw oversizedResponseError();
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (error instanceof YouTubeCommentProviderError) throw error;
    throw new YouTubeCommentProviderError(
      "YOUTUBE_RESPONSE_INVALID",
      "The YouTube read provider returned an unreadable response.",
    );
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const raw = new TextDecoder().decode(bytes);
  if (raw.length > MAX_YOUTUBE_RESPONSE_CHARS) {
    throw oversizedResponseError();
  }
  return raw;
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: URL,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(YOUTUBE_READ_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new YouTubeCommentProviderError(
      "YOUTUBE_PROVIDER_UNAVAILABLE",
      "The YouTube read provider could not be reached.",
    );
  }

  let raw: string;
  try {
    raw = await responseTextWithinLimit(response);
  } catch (error) {
    if (error instanceof YouTubeCommentProviderError) throw error;
    throw new YouTubeCommentProviderError(
      "YOUTUBE_RESPONSE_INVALID",
      "The YouTube read provider returned an unreadable response.",
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new YouTubeCommentProviderError(
      "YOUTUBE_RESPONSE_INVALID",
      "The YouTube read provider returned invalid JSON.",
    );
  }

  if (!response.ok) {
    const reason = apiReason(body);
    const status = apiStatus(body);
    if (
      response.status === 429 ||
      (reason !== null && YOUTUBE_QUOTA_REASONS.has(reason)) ||
      status === "RESOURCE_EXHAUSTED"
    ) {
      throw new YouTubeCommentProviderError(
        "YOUTUBE_QUOTA_EXHAUSTED",
        "The shared YouTube API quota is exhausted.",
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new YouTubeCommentProviderError(
        "YOUTUBE_AUTHORIZATION_FAILED",
        "The YouTube read provider authorization was rejected.",
      );
    }
    if (response.status === 404 && reason === "commentThreadNotFound") {
      throw new YouTubeCommentProviderError(
        "YOUTUBE_COMMENT_NOT_FOUND",
        "The YouTube comment thread is no longer available.",
      );
    }
    throw new YouTubeCommentProviderError(
      "YOUTUBE_API_FAILED",
      "The YouTube read provider returned an error.",
    );
  }

  return body;
}

function listResponse(body: unknown): {
  readonly items: readonly unknown[];
  readonly nextPageToken: string | null;
} {
  if (!isRecord(body) || !Array.isArray(body.items)) {
    throw new YouTubeCommentProviderError(
      "YOUTUBE_RESPONSE_INVALID",
      "The YouTube comment list response has an invalid shape.",
    );
  }
  const nextPageToken = property(body, "nextPageToken");
  if (
    nextPageToken !== undefined &&
    nextPageToken !== null &&
    (typeof nextPageToken !== "string" ||
      nextPageToken.length === 0 ||
      nextPageToken.length > MAX_PAGE_TOKEN_CHARS)
  ) {
    throw new YouTubeCommentProviderError(
      "YOUTUBE_RESPONSE_INVALID",
      "The YouTube comment list page token has an invalid shape.",
    );
  }
  return {
    items: body.items,
    nextPageToken: typeof nextPageToken === "string" ? nextPageToken : null,
  };
}

type YouTubeVideoDetails = Readonly<{
  channelId: string;
  title: string | null;
}>;

function videoDetailsFromResponse(
  body: unknown,
  expectedVideoId: string,
): YouTubeVideoDetails | null {
  if (!isRecord(body) || !Array.isArray(body.items) || body.items.length !== 1) {
    return null;
  }
  const returnedVideoId = boundedIdentifier(
    property(body.items[0], "id"),
    MAX_SCAN_ID_CHARS,
  );
  if (returnedVideoId !== expectedVideoId) return null;
  const snippet = property(body.items[0], "snippet");
  const channelId = boundedIdentifier(
    property(snippet, "channelId"),
    MAX_PROVIDER_ID_CHARS,
  );
  if (!channelId) return null;
  return {
    channelId,
    title: nonEmptyText(property(snippet, "title"), 300),
  };
}

async function defaultVideoDetailsFor(
  fetchImpl: typeof fetch,
  apiKey: string,
  videoId: string,
): Promise<YouTubeVideoDetails> {
  const url = new URL(`${YOUTUBE_DATA_API_BASE_URL}/videos`);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", apiKey);
  const details = videoDetailsFromResponse(
    await fetchJson(fetchImpl, url),
    videoId,
  );
  if (!details) {
    throw new YouTubeCommentProviderError(
      "YOUTUBE_VIDEO_UNAVAILABLE",
      "The requested YouTube Video is unavailable.",
    );
  }
  return details;
}

async function defaultVideoTitleFor(
  fetchImpl: typeof fetch,
  apiKey: string,
  videoId: string,
): Promise<string | null> {
  const details = await defaultVideoDetailsFor(fetchImpl, apiKey, videoId);
  if (!details.title) {
    throw new YouTubeCommentProviderError(
      "YOUTUBE_VIDEO_TITLE_UNAVAILABLE",
      "The current YouTube Video title was not available.",
    );
  }
  return details.title;
}

function pageFlags(
  threads: readonly ScanProviderThread[],
  nextPageToken: string | null,
  windowStart: Date,
): Pick<ScanProviderPage, "hasMoreWithinWindow" | "hasMoreOutsideWindow"> {
  const start = windowStart.getTime();
  const hasOutside = threads.some(
    (thread) => new Date(thread.publishedAt).getTime() < start,
  );
  return {
    hasMoreWithinWindow: !hasOutside && nextPageToken !== null,
    hasMoreOutsideWindow: hasOutside,
  };
}

export function createYouTubeCommentProvider(
  options: YouTubeProviderOptions = {},
): YouTubeCommentProvider {
  const readiness = inspectYouTubeCommentProvider(options);
  const target = YouTubeScanTargetSchema.safeParse(options.target).success
    ? (options.target as YouTubeScanTarget)
    : null;
  const apiKey = readApiKey(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const videoTitles = new Map<string, Promise<string | null>>();
  const ownedVideos = new Map<string, Promise<void>>();

  function assertReady(connectedChannelId: string): YouTubeScanTarget {
    if (!readiness.ready) blockedError(readiness);
    if (!target || !apiKey) {
      throw new YouTubeCommentProviderError(
        "YOUTUBE_SCAN_TARGET_UNAVAILABLE",
        "The verified YouTube scan target is unavailable.",
      );
    }
    assertConnectedTarget(target, connectedChannelId);
    return target;
  }

  function scopedVideoId(value: string | null | undefined): string | null {
    if (value == null) return null;
    const parsed = youtubeVideoIdSchema.safeParse(value);
    if (!parsed.success) {
      throw new YouTubeCommentProviderError(
        "YOUTUBE_VIDEO_SCOPE_UNAVAILABLE",
        "The owned YouTube Video identifier is invalid.",
      );
    }
    return parsed.data;
  }

  async function validateOwnedVideo(input: {
    connectedChannelId: string;
    videoId: string;
  }): Promise<void> {
    const verifiedTarget = assertReady(input.connectedChannelId);
    const video = scopedVideoId(input.videoId);
    if (!video) {
      throw new YouTubeCommentProviderError(
        "YOUTUBE_VIDEO_SCOPE_UNAVAILABLE",
        "An owned YouTube Video is required for a Video scan.",
      );
    }

    const validation =
      ownedVideos.get(video) ??
      (async () => {
        const details = await defaultVideoDetailsFor(fetchImpl, apiKey!, video);
        if (details.channelId !== verifiedTarget.providerChannelId) {
          throw new YouTubeCommentProviderError(
            "YOUTUBE_VIDEO_SCOPE_MISMATCH",
            "The requested YouTube Video is not owned by the verified Channel.",
          );
        }
      })();
    ownedVideos.set(video, validation);
    await validation;
  }

  async function listTopLevelThreads(input: {
    connectedChannelId: string;
    videoId?: string | null;
    windowStart: Date;
    windowEnd: Date;
    pageToken: string | null;
    pageSize: number;
  }): Promise<ScanProviderPage> {
    const verifiedTarget = assertReady(input.connectedChannelId);
    const video = scopedVideoId(input.videoId);
    if (video) {
      await validateOwnedVideo({
        connectedChannelId: input.connectedChannelId,
        videoId: video,
      });
    }
    if (
      input.pageToken !== null &&
      (input.pageToken.length === 0 ||
        input.pageToken.length > MAX_PAGE_TOKEN_CHARS)
    ) {
      throw new YouTubeCommentProviderError(
        "YOUTUBE_RESPONSE_INVALID",
        "The durable YouTube page token exceeded its safety bound.",
      );
    }
    const url = new URL(`${YOUTUBE_DATA_API_BASE_URL}/commentThreads`);
    url.searchParams.set("part", "snippet,replies");
    if (video) {
      url.searchParams.set("videoId", video);
    } else {
      url.searchParams.set(
        "allThreadsRelatedToChannelId",
        verifiedTarget.providerChannelId,
      );
    }
    url.searchParams.set("maxResults", String(boundedPageSize(input.pageSize)));
    url.searchParams.set("order", "time");
    url.searchParams.set("textFormat", "plainText");
    url.searchParams.set("key", apiKey!);
    if (input.pageToken !== null) {
      url.searchParams.set("pageToken", input.pageToken);
    }

    const page = listResponse(await fetchJson(fetchImpl, url));
    const normalizedItems = page.items
      .map((item) => normalizedThreadFor(item))
      .filter((thread): thread is ScanProviderThread => thread !== null)
      .filter((thread) => video === null || thread.videoId === video);
    const threads = normalizedItems
      .filter((thread) => {
        const timestamp = new Date(thread.publishedAt).getTime();
        return (
          timestamp >= input.windowStart.getTime() &&
          timestamp <= input.windowEnd.getTime()
        );
      });
    const flags = pageFlags(
      normalizedItems,
      page.nextPageToken,
      input.windowStart,
    );
    return {
      threads,
      nextPageToken: page.nextPageToken,
      ...flags,
    };
  }

  async function findThread(input: {
    connectedChannelId: string;
    videoId?: string | null;
    windowStart: Date;
    windowEnd: Date;
    threadId: string;
    contentHash: string;
  }): Promise<ScanProviderThread | null> {
    const verifiedTarget = assertReady(input.connectedChannelId);
    const video = scopedVideoId(input.videoId);
    if (video) {
      await validateOwnedVideo({
        connectedChannelId: input.connectedChannelId,
        videoId: video,
      });
    }
    const url = new URL(`${YOUTUBE_DATA_API_BASE_URL}/commentThreads`);
    url.searchParams.set("part", "snippet,replies");
    url.searchParams.set("id", input.threadId);
    url.searchParams.set("textFormat", "plainText");
    url.searchParams.set("key", apiKey!);

    let body: unknown;
    try {
      body = await fetchJson(fetchImpl, url);
    } catch (error) {
      if (
        error instanceof YouTubeCommentProviderError &&
        error.code === "YOUTUBE_COMMENT_NOT_FOUND"
      ) {
        return null;
      }
      throw error;
    }
    const page = listResponse(body);
    const item = page.items.find(
      (candidate) => threadId(candidate) === input.threadId,
    );
    if (!item) return null;
    const thread = normalizedThreadFor(item);
    if (!thread) return null;
    if (video && thread.videoId !== video) {
      throw new YouTubeCommentProviderError(
        "YOUTUBE_VIDEO_SCOPE_MISMATCH",
        "The current YouTube comment is outside the requested Video scope.",
      );
    }
    const timestamp = new Date(thread.publishedAt).getTime();
    if (
      timestamp < input.windowStart.getTime() ||
      timestamp > input.windowEnd.getTime()
    ) {
      return null;
    }
    const currentText = sourceCommentText(
      property(property(item, "snippet"), "topLevelComment"),
    );
    if (!currentText) {
      throw new YouTubeCommentProviderError(
        "YOUTUBE_RESPONSE_INVALID",
        "The current YouTube comment text was not available.",
      );
    }
    const titlePromise = videoTitles.get(thread.videoId) ??
      (options.videoTitleFor
        ? options.videoTitleFor(thread.videoId)
        : defaultVideoTitleFor(fetchImpl, apiKey!, thread.videoId));
    videoTitles.set(thread.videoId, titlePromise);
    const title = await titlePromise;
    const normalizedTitle = nonEmptyText(title, 300);
    if (!normalizedTitle) {
      throw new YouTubeCommentProviderError(
        "YOUTUBE_VIDEO_TITLE_UNAVAILABLE",
        "The current YouTube Video title was not available.",
      );
    }
    const context = contextFor(
      item,
      verifiedTarget,
      currentText,
      normalizedTitle,
    );
    if (!context) {
      throw new YouTubeCommentProviderError(
        "YOUTUBE_RESPONSE_INVALID",
        "The YouTube comment thread lacked bounded assessment context.",
      );
    }
    return { ...thread, assessmentContext: context };
  }

  async function assess(thread: ScanProviderThread): Promise<unknown> {
    if (!thread.assessmentContext) {
      throw new YouTubeCommentProviderError(
        "YOUTUBE_ASSESSMENT_CONTEXT_UNAVAILABLE",
        "A revalidated YouTube interaction context is required before assessment.",
      );
    }
    if (!options.assessInteraction) {
      throw new YouTubeCommentProviderError(
        "YOUTUBE_ASSESSMENT_PROVIDER_UNAVAILABLE",
        "The structured Interaction Assessment provider is not configured.",
      );
    }
    const assessment = await options.assessInteraction(thread.assessmentContext);
    return {
      kind: "interaction",
      context: thread.assessmentContext,
      assessment,
    } satisfies InteractionAssessmentEvaluation;
  }

  return {
    kind: YOUTUBE_SCAN_PROVIDER,
    readiness,
    validateOwnedVideo,
    listTopLevelThreads,
    findThread,
    assess,
  };
}
