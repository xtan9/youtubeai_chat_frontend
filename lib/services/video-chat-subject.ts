import "server-only";
import { extractVideoId } from "./youtube-url";
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
  readonly retainedThread?: VideoChatCapabilityTarget;
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
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;

  const youtubeVideoId = extractVideoId(value);
  if (!youtubeVideoId) return null;

  return {
    youtubeVideoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
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
      if (result.status === "resolved") return result;
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
