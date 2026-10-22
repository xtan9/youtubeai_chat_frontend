import { fetchVideoMetadata, type VideoMetadataResult } from "./video-metadata";
import { type VpsMetadataResult } from "./vps-metadata";
import { logAppEvent, videoIdForLog } from "../observability";
import { type TranscriptAcquisitionInput } from "./transcript-acquisition-contract";

export type MetadataFields = {
  title?: string;
  channelName?: string;
};

export function nonBlank(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function hasCompleteMetadata(fields: MetadataFields): boolean {
  return fields.title !== undefined && fields.channelName !== undefined;
}

export function mergeMetadata(
  current: MetadataFields,
  result: VideoMetadataResult
): { fields: MetadataFields; recovered: boolean } {
  if (!result.ok) return { fields: current, recovered: false };

  const recoveredTitle =
    current.title === undefined ? nonBlank(result.data.title) : undefined;
  const recoveredChannel =
    current.channelName === undefined
      ? nonBlank(result.data.channelName)
      : undefined;

  return {
    fields: {
      title: current.title ?? recoveredTitle,
      channelName: current.channelName ?? recoveredChannel,
    },
    recovered: recoveredTitle !== undefined || recoveredChannel !== undefined,
  };
}

export function logMetadataDegradation(
  input: TranscriptAcquisitionInput,
  result: Exclude<VpsMetadataResult, { ok: true }>
): void {
  if (result.reason === "aborted" || input.signal.aborted) return;

  if (result.reason === "non_ok" && result.status === 404) {
    logAppEvent("warn", "[transcript-acquisition] metadata endpoint unavailable", {
      errorId: "VPS_METADATA_404",
      status: 404,
      videoId: videoIdForLog(input.youtubeUrl),
      requestId: input.requestId,
    });
    return;
  }

  logAppEvent("error", "[transcript-acquisition] language detection degraded", {
    errorId: "TRANSCRIPT_LANGUAGE_DETECTION_DEGRADED",
    reason: result.reason,
    ...(result.reason === "non_ok" ? { status: result.status } : {}),
    ...(result.reason === "error"
      ? {
          errorName:
            result.error instanceof Error
              ? result.error.name
              : typeof result.error,
        }
      : {}),
    videoId: videoIdForLog(input.youtubeUrl),
    requestId: input.requestId,
  });
}

export function logMetadataRecoveryFailure(
  input: TranscriptAcquisitionInput,
  result: Exclude<VideoMetadataResult, { ok: true }>
): void {
  if (result.reason === "aborted" || input.signal.aborted) return;

  logAppEvent("warn", "[transcript-acquisition] metadata recovery failed", {
    errorId: "TRANSCRIPT_METADATA_RECOVERY_FAILED",
    reason: result.reason,
    ...(result.reason === "non_ok" ? { status: result.status } : {}),
    ...(result.reason === "error"
      ? {
          errorName:
            result.error instanceof Error
              ? result.error.name
              : typeof result.error,
        }
      : {}),
    videoId: videoIdForLog(input.youtubeUrl),
    requestId: input.requestId,
  });
}

export async function recoverMetadata(
  input: TranscriptAcquisitionInput
): Promise<VideoMetadataResult> {
  try {
    return await fetchVideoMetadata(input.youtubeUrl, input.signal);
  } catch (error) {
    return input.signal.aborted
      ? { ok: false, reason: "aborted" }
      : { ok: false, reason: "error", error };
  }
}

export type MetadataRecovery = {
  readonly fields: MetadataFields;
  readonly recovered: boolean;
};

export async function recoverMissingMetadata(
  input: TranscriptAcquisitionInput,
  fields: MetadataFields
): Promise<MetadataRecovery> {
  if (hasCompleteMetadata(fields)) return { fields, recovered: false };

  const metadata = await recoverMetadata(input);
  if (!metadata.ok) {
    logMetadataRecoveryFailure(input, metadata);
    return { fields, recovered: false };
  }

  return mergeMetadata(fields, metadata);
}
