import { z } from "zod";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import {
  normalizeYouTubeVideoId,
} from "@/lib/services/youtube-url";

const PROVIDER_PATH = "youtube_data_api_v3_videos_list";
const EVIDENCE_FRESHNESS_MS = 24 * 60 * 60 * 1_000;

const ThumbnailSchema = z.object({ url: z.string().url() });
const YouTubeVideoSchema = z.object({
  id: z.string(),
  snippet: z.object({
    title: z.string().min(1),
    channelId: z.string().min(1),
    channelTitle: z.string().min(1),
    publishedAt: z.string().datetime(),
    defaultLanguage: z.string().optional(),
    defaultAudioLanguage: z.string().optional(),
    liveBroadcastContent: z.enum(["none", "live", "upcoming"]),
    thumbnails: z
      .object({
        default: ThumbnailSchema.optional(),
        medium: ThumbnailSchema.optional(),
        high: ThumbnailSchema.optional(),
        standard: ThumbnailSchema.optional(),
        maxres: ThumbnailSchema.optional(),
      })
      .passthrough(),
  }),
  status: z.object({
    privacyStatus: z.enum(["public", "private", "unlisted"]),
    embeddable: z.boolean(),
  }),
  contentDetails: z.object({
    duration: z.string(),
    contentRating: z
      .object({ ytRating: z.string().optional() })
      .passthrough(),
  }),
});

const YouTubeVideosResponseSchema = z.object({
  items: z.array(YouTubeVideoSchema).max(1),
});

export type CatalogProviderFailureCode =
  | "provider_timeout"
  | "provider_non_ok"
  | "provider_schema"
  | "provider_error";

export interface CatalogAdmissionEvidence {
  readonly providerPath: typeof PROVIDER_PATH;
  readonly youtubeVideoId: string;
  readonly title: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly thumbnailUrl: string | null;
  readonly defaultLanguage: string | null;
  readonly durationSeconds: number;
  readonly publishedAt: string;
  readonly privacyStatus: "public" | "private" | "unlisted";
  readonly embeddable: boolean;
  readonly liveStatus: "none" | "live" | "upcoming";
  readonly ageRestricted: boolean;
  readonly providerVerifiedAt: string;
  readonly evidenceExpiresAt: string;
}

export type CatalogProviderEvidenceResult =
  | { readonly outcome: "verified"; readonly evidence: CatalogAdmissionEvidence }
  | {
      readonly outcome: "absent";
      readonly evidence: Pick<
        CatalogAdmissionEvidence,
        | "providerPath"
        | "youtubeVideoId"
        | "providerVerifiedAt"
        | "evidenceExpiresAt"
      >;
    }
  | {
      readonly outcome: "unavailable";
      readonly failureCode: CatalogProviderFailureCode;
    };

export type CatalogNominationOutcome =
  | { readonly outcome: "enqueued" }
  | { readonly outcome: "already_enqueued" }
  | {
      readonly outcome: "skipped";
      readonly reason: "provider_unavailable" | "ineligible" | "cancelled";
    };

export interface CatalogNominationInput {
  readonly youtubeUrl: string;
  readonly requestId: string;
  readonly signal?: AbortSignal;
  readonly isCancelled?: () => boolean;
}

export class CatalogNominationError extends Error {
  readonly errorId = "CATALOG_NOMINATION_ENQUEUE_FAILED";

  constructor(cause?: unknown) {
    super("Catalog Nomination enqueue failed", { cause });
    this.name = "CatalogNominationError";
  }
}

function parseIsoDurationSeconds(value: string): number | null {
  const match = value.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/,
  );
  if (!match) return null;
  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] =
    match;
  const total =
    Number(days) * 86_400 +
    Number(hours) * 3_600 +
    Number(minutes) * 60 +
    Number(seconds);
  return Number.isFinite(total) && total >= 0 ? total : null;
}

function preferredThumbnail(
  thumbnails: z.infer<typeof YouTubeVideoSchema>["snippet"]["thumbnails"],
): string | null {
  return (
    thumbnails.maxres?.url ??
    thumbnails.standard?.url ??
    thumbnails.high?.url ??
    thumbnails.medium?.url ??
    thumbnails.default?.url ??
    null
  );
}

export async function fetchCatalogAdmissionEvidence(
  youtubeVideoId: string,
  options: {
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
  } = {},
): Promise<CatalogProviderEvidenceResult> {
  const apiKey = process.env.YOUTUBE_DATA_API_KEY?.trim();
  if (!apiKey) {
    return { outcome: "unavailable", failureCode: "provider_error" };
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set(
    "part",
    "snippet,status,contentDetails,liveStreamingDetails",
  );
  url.searchParams.set("id", youtubeVideoId);
  url.searchParams.set("key", apiKey);

  try {
    const timeoutSignal = AbortSignal.timeout(
      Math.min(Math.max(options.timeoutMs ?? 10_000, 1_000), 10_000),
    );
    const response = await fetch(url, {
      signal: options.signal
        ? AbortSignal.any([options.signal, timeoutSignal])
        : timeoutSignal,
    });
    if (!response.ok) {
      return { outcome: "unavailable", failureCode: "provider_non_ok" };
    }
    const parsed = YouTubeVideosResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return { outcome: "unavailable", failureCode: "provider_schema" };
    }
    const verifiedAt = new Date();
    const evidenceWindow = {
      providerPath: PROVIDER_PATH,
      youtubeVideoId,
      providerVerifiedAt: verifiedAt.toISOString(),
      evidenceExpiresAt: new Date(
        verifiedAt.getTime() + EVIDENCE_FRESHNESS_MS,
      ).toISOString(),
    } as const;
    if (parsed.data.items.length === 0) {
      return { outcome: "absent", evidence: evidenceWindow };
    }
    const video = parsed.data.items[0];
    if (video.id !== youtubeVideoId) {
      return { outcome: "unavailable", failureCode: "provider_schema" };
    }
    const durationSeconds = parseIsoDurationSeconds(video.contentDetails.duration);
    if (durationSeconds === null) {
      return { outcome: "unavailable", failureCode: "provider_schema" };
    }
    return {
      outcome: "verified",
      evidence: {
        ...evidenceWindow,
        title: video.snippet.title,
        channelId: video.snippet.channelId,
        channelName: video.snippet.channelTitle,
        thumbnailUrl: preferredThumbnail(video.snippet.thumbnails),
        defaultLanguage:
          video.snippet.defaultAudioLanguage ??
          video.snippet.defaultLanguage ??
          null,
        durationSeconds,
        publishedAt: video.snippet.publishedAt,
        privacyStatus: video.status.privacyStatus,
        embeddable: video.status.embeddable,
        liveStatus: video.snippet.liveBroadcastContent,
        ageRestricted:
          video.contentDetails.contentRating.ytRating === "ytAgeRestricted",
      },
    };
  } catch (error) {
    return {
      outcome: "unavailable",
      failureCode:
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
          ? "provider_timeout"
          : "provider_error",
    };
  }
}

/**
 * Independently verifies and nominates a successful Summary's Video.
 *
 * No learner-linked or generated content crosses this boundary. The videos
 * upsert is the service-role command surface; its database trigger owns the
 * idempotent private Nomination and high-priority durable queue write.
 */
export async function nominateCatalogVideoForAdmission(
  input: CatalogNominationInput,
): Promise<CatalogNominationOutcome> {
  const isCancelled = () =>
    input.signal?.aborted === true || input.isCancelled?.() === true;
  const youtubeVideoId = normalizeYouTubeVideoId(input.youtubeUrl);
  if (!youtubeVideoId) {
    return { outcome: "skipped", reason: "provider_unavailable" };
  }

  const providerResult = await fetchCatalogAdmissionEvidence(youtubeVideoId, {
    signal: input.signal,
  });
  if (isCancelled()) return { outcome: "skipped", reason: "cancelled" };
  if (providerResult.outcome !== "verified") {
    return { outcome: "skipped", reason: "provider_unavailable" };
  }
  const video = providerResult.evidence;

  const isEligible =
    video.privacyStatus === "public" &&
    video.embeddable &&
    video.liveStatus === "none" &&
    !video.ageRestricted;
  if (!isEligible) return { outcome: "skipped", reason: "ineligible" };

  const supabase = getServiceRoleClient();
  if (!supabase) {
    throw new CatalogNominationError(new Error("service role unavailable"));
  }

  if (isCancelled()) return { outcome: "skipped", reason: "cancelled" };
  const { data, error } = await supabase.rpc("request_catalog_nomination", {
      p_youtube_video_id: youtubeVideoId,
      p_title: video.title,
      p_channel_id: video.channelId,
      p_channel_name: video.channelName,
      p_thumbnail_url: video.thumbnailUrl,
      p_default_language: video.defaultLanguage,
      p_duration_seconds: video.durationSeconds,
      p_published_at: video.publishedAt,
      p_privacy_status: video.privacyStatus,
      p_embeddable: video.embeddable,
      p_live_status: video.liveStatus,
      p_age_restricted: video.ageRestricted,
      p_provider_path: video.providerPath,
      p_provider_verified_at: video.providerVerifiedAt,
      p_evidence_expires_at: video.evidenceExpiresAt,
      p_trace_id: input.requestId,
    });

  if (error) throw new CatalogNominationError(error);
  return data && typeof data === "object" && "outcome" in data
    ? (data as CatalogNominationOutcome)
    : { outcome: "enqueued" };
}
