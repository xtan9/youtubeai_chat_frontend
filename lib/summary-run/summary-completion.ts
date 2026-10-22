import type { SupportedLanguageCode } from "@/lib/constants/languages";
import { after } from "next/server";
import type { LogStage } from "@/lib/stages";
import { logAppEvent, videoIdForLog } from "@/lib/observability";
import { nominateCatalogVideoForAdmission } from "@/lib/catalog/catalog-admission";
import { runCatalogAdmissionWorker } from "@/lib/catalog/catalog-admission-worker";
import { type ServerSummaryRunPersistence } from "./server-summary-run";

export function createSummaryCompletionHandler({
  request, requestId, userId, youtube_url, persistence, outputLanguageCode, isCancelled,
}: {
  readonly request: Request;
  readonly requestId: string;
  readonly userId: string;
  readonly youtube_url: string;
  readonly persistence: ServerSummaryRunPersistence;
  readonly outputLanguageCode: SupportedLanguageCode | undefined;
  readonly isCancelled: () => boolean;
}) {
  const nominateSuccessfulSummary = async (): Promise<void> => {
    let nomination: Awaited<
      ReturnType<typeof nominateCatalogVideoForAdmission>
    >;
    try {
      nomination = await nominateCatalogVideoForAdmission({
        youtubeUrl: youtube_url,
        requestId,
        signal: request.signal,
        isCancelled,
      });
    } catch (err) {
      const errorId =
        err &&
        typeof err === "object" &&
        "errorId" in err &&
        err.errorId === "CATALOG_NOMINATION_ENQUEUE_FAILED"
          ? err.errorId
          : "CATALOG_NOMINATION_FAILED";
      logAppEvent(
        "error",
        "[summarize/stream] Catalog Nomination failed (fail-soft)",
        {
          errorId,
          stage: "catalog_nomination",
          videoId: videoIdForLog(youtube_url),
          requestId,
          errorName: err instanceof Error ? err.name : typeof err,
        },
      );
      return;
    }

    // PGMQ owns durability before this best-effort drain begins. Deferred
    // Summary persistence runs inside next/server `after`, so this cannot
    // delay the streamed response. Required persistence deliberately skips
    // the assist. The daily cron remains the recovery path if an invocation
    // ends early, and only a new queue write spends worker capacity.
    if (persistence !== "deferred" || nomination.outcome !== "enqueued") {
      return;
    }
    try {
      await runCatalogAdmissionWorker();
    } catch (err) {
      logAppEvent(
        "error",
        "[summarize/stream] Catalog Admission drain failed (fail-soft)",
        {
          errorId: "CATALOG_ADMISSION_DRAIN_FAILED",
          stage: "catalog_admission",
          videoId: videoIdForLog(youtube_url),
          requestId,
          errorName: err instanceof Error ? err.name : typeof err,
        },
      );
    }
  };

  return async (
    persist?: () => Promise<void>,
  ): Promise<void> => {
    if (isCancelled() || request.signal.aborted) return;
    const complete = async (): Promise<void> => {
      if (persist) await persist();
      if (isCancelled() || request.signal.aborted) return;
      await nominateSuccessfulSummary();
    };

    if (persistence === "required") {
      await complete();
      return;
    }

    try {
      after(complete);
    } catch (err) {
      if (persist) {
        logAppEvent(
          "error",
          "[summarize/stream] CACHE_WRITE_SCHEDULE_FAILED",
          {
            errorId: "CACHE_WRITE_SCHEDULE_FAILED",
            stage: "cache" satisfies LogStage,
            videoId: videoIdForLog(youtube_url),
            requestId,
            userId,
            outputLanguage: outputLanguageCode ?? null,
            errorName: err instanceof Error ? err.name : typeof err,
          },
        );
      }
      logAppEvent(
        "error",
        "[summarize/stream] Catalog Nomination scheduling failed (fail-soft)",
        {
          errorId: "CATALOG_NOMINATION_SCHEDULE_FAILED",
          stage: "catalog_nomination",
          videoId: videoIdForLog(youtube_url),
          requestId,
          errorName: err instanceof Error ? err.name : typeof err,
        },
      );
    }
  };

}
