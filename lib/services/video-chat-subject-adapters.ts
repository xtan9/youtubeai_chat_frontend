import "server-only";
import { z } from "zod";
import { isHeroDemoVideoId } from "@/lib/constants/hero-demo-ids";
import { logAppEvent } from "@/lib/observability";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import type {
  CanonicalVideoIdentity,
  VideoChatSubject,
  VideoChatSubjectAdapter,
  VideoChatSubjectAdapterResult,
} from "./video-chat-subject";

const DatabaseVideoRowSchema = z.object({
  id: z.string().min(1),
});

function statelessHeroDemoSubject(
  identity: CanonicalVideoIdentity,
): VideoChatSubject {
  return {
    identity,
    source: "hero_demo",
  };
}

function databaseSubject(
  identity: CanonicalVideoIdentity,
  videoId: string,
): VideoChatSubject {
  return {
    identity,
    source: "database",
    retainedThread: { videoId },
    entitlement: { videoId },
    suggestionCache: { videoId },
  };
}

export function createHeroDemoVideoChatSubjectAdapter(): VideoChatSubjectAdapter {
  return {
    kind: "hero_demo",
    async resolve(
      identity: CanonicalVideoIdentity,
    ): Promise<VideoChatSubjectAdapterResult> {
      // The resolver only selects this adapter for the allowlist. Keep the
      // guard here as a defense for direct adapter callers without ever
      // falling through to the database source.
      if (!isHeroDemoVideoId(identity.youtubeVideoId)) {
        return { status: "not_ready" };
      }
      return {
        status: "resolved",
        subject: statelessHeroDemoSubject(identity),
      };
    },
  };
}

export function createDatabaseVideoChatSubjectAdapter(): VideoChatSubjectAdapter {
  return {
    kind: "database",
    async resolve(
      identity: CanonicalVideoIdentity,
    ): Promise<VideoChatSubjectAdapterResult> {
      const supabase = getServiceRoleClient();
      if (!supabase) {
        logAppEvent("error", "[video-chat-subject] database client unavailable", {
          errorId: "VIDEO_CHAT_SUBJECT_DATABASE_UNAVAILABLE",
          videoId: identity.youtubeVideoId,
          errorClass: "ServiceRoleUnavailable",
        });
        return { status: "unavailable" };
      }

      try {
        // url_hash is the existing canonical cache key. Selecting only the
        // Video row keeps this history boundary independent of Transcript
        // and Summary Grounding.
        const { data, error } = await supabase
          .from("videos")
          .select("id")
          .eq("url_hash", identity.youtubeVideoId)
          .maybeSingle();

        if (error) {
          logAppEvent("error", "[video-chat-subject] database lookup failed", {
            errorId: "VIDEO_CHAT_SUBJECT_DATABASE_LOOKUP_FAILED",
            videoId: identity.youtubeVideoId,
            errorClass: "SupabaseError",
          });
          return { status: "unavailable" };
        }

        if (!data) return { status: "not_ready" };

        const parsed = DatabaseVideoRowSchema.safeParse(data);
        if (!parsed.success) {
          logAppEvent(
            "error",
            "[video-chat-subject] database row schema mismatch",
            {
              errorId: "VIDEO_CHAT_SUBJECT_DATABASE_SCHEMA_MISMATCH",
              videoId: identity.youtubeVideoId,
              errorClass: "SchemaMismatch",
            },
          );
          return { status: "unavailable" };
        }

        return {
          status: "resolved",
          subject: databaseSubject(identity, parsed.data.id),
        };
      } catch (error) {
        logAppEvent("error", "[video-chat-subject] database lookup threw", {
          errorId: "VIDEO_CHAT_SUBJECT_DATABASE_LOOKUP_FAILED",
          videoId: identity.youtubeVideoId,
          errorName: error instanceof Error ? error.name : typeof error,
          errorClass: "DatabaseAdapterError",
        });
        return { status: "unavailable" };
      }
    },
  };
}

export const heroDemoVideoChatSubjectAdapter =
  createHeroDemoVideoChatSubjectAdapter();

export const databaseVideoChatSubjectAdapter =
  createDatabaseVideoChatSubjectAdapter();
