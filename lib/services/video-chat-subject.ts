import "server-only";
import {
  canonicalYouTubeUrl,
  normalizeYouTubeVideoId,
} from "./youtube-url";
import { isHeroDemoVideoId } from "@/lib/constants/hero-demo-ids";
import {
  databaseVideoChatSubjectAdapter,
  heroDemoVideoChatSubjectAdapter,
} from "./video-chat-subject-adapters";
import { logAppEvent } from "@/lib/observability";
import type { SupportedLanguageCode } from "@/lib/constants/languages";
import type { CachedSummary, CachedTranscript } from "./summarize-cache";
import type { SuggestedFollowups } from "./suggested-followups";

export type VideoChatSubjectSource = "hero_demo" | "database";

export interface CanonicalVideoIdentity {
  readonly youtubeVideoId: string;
  readonly canonicalUrl: string;
}

export interface VideoChatCapabilityTarget {
  readonly videoId: string;
}

export type VideoChatRetainedThread =
  | { readonly kind: "database"; readonly videoId: string }
  | { readonly kind: "hero_demo"; readonly youtubeVideoId: string };

export type VideoGroundingTranscript = Omit<CachedTranscript, "language"> & {
  readonly language: SupportedLanguageCode;
};

export type VideoGroundingSummary = Omit<CachedSummary, "language"> & {
  readonly language: SupportedLanguageCode;
};

export interface VideoGrounding {
  readonly transcript: VideoGroundingTranscript;
  readonly summary: VideoGroundingSummary;
}

export type VideoGroundingResolution =
  | { readonly status: "ready"; readonly grounding: VideoGrounding }
  | { readonly status: "not_ready" }
  | { readonly status: "unavailable" };

export interface VideoGroundingCapability {
  load(): Promise<VideoGroundingResolution>;
}

export interface SuggestionCacheCapability extends VideoChatCapabilityTarget {
  read(): Promise<SuggestedFollowups | null>;
  write(followups: SuggestedFollowups): Promise<void>;
}

/**
 * The identity of the YouTube Video is deliberately separate from the
 * storage targets used by each optional capability. A database UUID is not
 * a valid substitute for a YouTube ID, and a stateless subject has no
 * retained-thread target at all.
 */
export interface VideoChatSubject {
  readonly identity: CanonicalVideoIdentity;
  readonly source: VideoChatSubjectSource;
  readonly retainedThread?: VideoChatRetainedThread;
  readonly entitlement?: VideoChatCapabilityTarget;
  readonly suggestionCache?: SuggestionCacheCapability;
  readonly grounding?: VideoGroundingCapability;
}

export type VideoChatSubjectAdapterResult =
  | { readonly status: "resolved"; readonly subject: VideoChatSubject }
  | { readonly status: "not_ready" }
  | { readonly status: "unavailable" };

export interface VideoChatSubjectAdapter {
  readonly kind: VideoChatSubjectSource;
  resolve(
    identity: CanonicalVideoIdentity,
  ): Promise<VideoChatSubjectAdapterResult>;
}

export interface VideoChatSubjectAdapters {
  readonly heroDemo: VideoChatSubjectAdapter;
  readonly database: VideoChatSubjectAdapter;
}

export function memoizeVideoGroundingLoader(
  load: () => Promise<VideoGroundingResolution>,
): VideoGroundingCapability {
  let loaded: Promise<VideoGroundingResolution> | undefined;

  return {
    load() {
      // Promise.resolve().then also memoizes a synchronous throw from a
      // custom adapter as a rejected promise, preserving the at-most-once
      // guarantee for every loader implementation.
      loaded ??= Promise.resolve().then(load);
      return loaded;
    },
  };
}

function hasCoherentVideoGrounding(
  subject: VideoChatSubject,
  grounding: VideoGrounding,
): boolean {
  const groundingVideoId = grounding.transcript.videoId;
  if (grounding.summary.videoId !== groundingVideoId) return false;

  const capabilityTargets = [
    subject.retainedThread?.kind === "database"
      ? { videoId: subject.retainedThread.videoId }
      : undefined,
    subject.entitlement,
    subject.suggestionCache,
  ];
  const targetVideoIds = capabilityTargets
    .filter((target): target is VideoChatCapabilityTarget => target !== undefined)
    .map((target) => target.videoId);

  if (subject.retainedThread?.kind === "hero_demo") {
    return (
      targetVideoIds.length === 0 &&
      groundingVideoId === subject.retainedThread.youtubeVideoId &&
      groundingVideoId === subject.identity.youtubeVideoId
    );
  }

  if (targetVideoIds.length === 0) {
    return groundingVideoId === subject.identity.youtubeVideoId;
  }

  return targetVideoIds.every((videoId) => videoId === groundingVideoId);
}

function withCoherentVideoGrounding(
  subject: VideoChatSubject,
): VideoChatSubject {
  const grounding = subject.grounding;
  if (!grounding) return subject;

  return {
    ...subject,
    grounding: memoizeVideoGroundingLoader(async () => {
      const outcome = await grounding.load();
      if (
        outcome.status !== "ready" ||
        hasCoherentVideoGrounding(subject, outcome.grounding)
      ) {
        return outcome;
      }

      logAppEvent("error", "[video-chat-subject] Grounding Video mismatch", {
        errorId: "VIDEO_CHAT_SUBJECT_GROUNDING_VIDEO_MISMATCH",
        videoId: subject.identity.youtubeVideoId,
        source: subject.source,
        errorClass: "SchemaMismatch",
      });
      return { status: "unavailable" };
    }),
  };
}

export type VideoChatSubjectResolution =
  | { readonly status: "invalid" }
  | { readonly status: "resolved"; readonly subject: VideoChatSubject }
  | {
      readonly status: "not_ready";
      readonly identity: CanonicalVideoIdentity;
    }
  | {
      readonly status: "unavailable";
      readonly identity: CanonicalVideoIdentity;
    };

/**
 * Collapse every supported YouTube URL shape to one Video identity before
 * any source adapter can do work. The request route already requires HTTPS;
 * keeping that requirement here makes this boundary safe for other callers.
 */
export function canonicalizeVideoChatUrl(
  youtubeUrl: string,
): CanonicalVideoIdentity | null {
  const value = youtubeUrl.trim();
  const youtubeVideoId = normalizeYouTubeVideoId(value);
  if (!youtubeVideoId) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) {
    return {
      youtubeVideoId,
      canonicalUrl: canonicalYouTubeUrl(youtubeVideoId),
    };
  }
  try {
    if (new URL(value).protocol !== "https:") return null;
  } catch {
    return null;
  }

  return {
    youtubeVideoId,
    canonicalUrl: canonicalYouTubeUrl(youtubeVideoId),
  };
}

export function createVideoChatSubjectResolver(
  adapters: VideoChatSubjectAdapters,
): (youtubeUrl: string) => Promise<VideoChatSubjectResolution> {
  return async (youtubeUrl) => {
    const identity = canonicalizeVideoChatUrl(youtubeUrl);
    if (!identity) return { status: "invalid" };

    // Selection is intentionally exclusive. In particular, a Hero Demo
    // source failure must remain unavailable rather than probing the DB.
    const adapter = isHeroDemoVideoId(identity.youtubeVideoId)
      ? adapters.heroDemo
      : adapters.database;

    try {
      const result = await adapter.resolve(identity);
      if (result.status === "resolved") {
        return {
          status: "resolved",
          subject: withCoherentVideoGrounding(result.subject),
        };
      }
      return { status: result.status, identity };
    } catch (error) {
      logAppEvent("error", "[video-chat-subject] adapter threw", {
        errorId: "VIDEO_CHAT_SUBJECT_RESOLUTION_FAILED",
        videoId: identity.youtubeVideoId,
        source: adapter.kind,
        errorName: error instanceof Error ? error.name : typeof error,
        errorClass: "AdapterError",
      });
      return { status: "unavailable", identity };
    }
  };
}

const defaultAdapters: VideoChatSubjectAdapters = {
  heroDemo: heroDemoVideoChatSubjectAdapter,
  database: databaseVideoChatSubjectAdapter,
};

const defaultResolver = createVideoChatSubjectResolver(defaultAdapters);

export function resolveVideoChatSubject(
  youtubeUrl: string,
): Promise<VideoChatSubjectResolution> {
  return defaultResolver(youtubeUrl);
}
