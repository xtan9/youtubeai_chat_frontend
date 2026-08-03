"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/contexts/user-context";
import { useAnonSession } from "@/lib/hooks/useAnonSession";
import { getAuthErrorInfo } from "@/lib/utils/youtube";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import type {
  SummaryRunControllerOptions,
  SummaryRunFailureKind,
  SummaryRunOutcome,
} from "@/lib/summary-run";
import { useSummaryRun } from "@/lib/hooks/useSummaryRun";

export { SummaryRequestError } from "@/lib/summary-run";

function failureCategoryForAnalytics(
  kind: SummaryRunFailureKind,
): "auth" | "quota" | "rate_limit" | "request" | "processing" {
  if (kind === "authentication") return "auth";
  if (kind === "quota") return "quota";
  if (kind === "rate_limit") return "rate_limit";
  if (kind === "processing" || kind === "protocol") return "processing";
  return "request";
}

/**
 * Summary-page adapter. Authentication provisioning and login navigation are
 * page concerns; the lifecycle itself stays in `createSummaryRunController`.
 */
export function useYouTubeSummarizer() {
  const { user, session } = useUser();
  const router = useRouter();
  const { anonSession, isLoading } = useAnonSession();

  const handleAuthError = useCallback(
    (status: number, message: string) => {
      const errorInfo = getAuthErrorInfo(status, message);
      if (errorInfo.shouldRedirect && user) {
        setTimeout(() => {
          router.push("/auth/login");
        }, errorInfo.redirectDelay);
      }
    },
    [router, user],
  );

  const getAccessToken = useCallback(
    () => session?.access_token || anonSession?.access_token || null,
    [anonSession?.access_token, session?.access_token],
  );
  const isAnonymous =
    user?.is_anonymous === true || (!session && !!anonSession);
  const handleOutcome = useCallback(
    (outcome: SummaryRunOutcome) => {
      const accountType = isAnonymous ? "anonymous" : "registered";
      const outputLanguage = outcome.outputLanguage ?? "video_native";

      if (outcome.outcome === "success") {
        captureAnalyticsEvent("summary_succeeded", {
          account_type: accountType,
          source_surface: "summary",
          result_origin: outcome.origin,
          output_language: outputLanguage,
          transcription_seconds: outcome.timings.transcriptionSeconds,
          summary_seconds: outcome.timings.summarySeconds,
          total_seconds: outcome.timings.totalSeconds,
        });
        return;
      }

      captureAnalyticsEvent("summary_failed", {
        account_type: accountType,
        source_surface: "summary",
        output_language: outputLanguage,
        failure_category: failureCategoryForAnalytics(outcome.failure.kind),
        error_code: outcome.failure.code,
        ...(outcome.failure.status !== undefined
          ? { http_status: outcome.failure.status }
          : {}),
      });
    },
    [isAnonymous],
  );
  const runOptions = useMemo<SummaryRunControllerOptions>(
    () => ({
      getAccessToken,
      onAuthError: handleAuthError,
      onOutcome: handleOutcome,
    }),
    [getAccessToken, handleAuthError, handleOutcome],
  );
  const run = useSummaryRun(runOptions);

  return {
    ...run,
    isAnonymous,
    isAuthLoading: isLoading,
  };
}
