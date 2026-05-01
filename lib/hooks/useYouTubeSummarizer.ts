import { useUser } from "@/lib/contexts/user-context";
import { useAnonSession } from "@/lib/hooks/useAnonSession";

import type { SummaryResult } from "@/lib/types";
import type { SupportedLanguageCode } from "@/lib/constants/languages";
import { getAuthErrorInfo } from "@/lib/utils/youtube";
import { UpgradeRequiredError } from "@/lib/errors/upgrade-required";
import {
  QueryFunctionContext,
  useQuery,
  experimental_streamedQuery as streamedQuery,
  UseQueryOptions,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

const debugLog: (...args: unknown[]) => void =
  process.env.NODE_ENV === "production" ? () => {} : console.log;

// `outputLanguage = null` means "use the video's own language" — matches the
// server's cache-key convention. Adding it to the queryKey means switching
// languages auto-invalidates the cached query and re-fetches without us
// having to orchestrate refetch manually.
export function useYouTubeSummarizer(
  url: string,
  includeTranscript: boolean = true,
  outputLanguage: SupportedLanguageCode | null = null
) {
  const { user, session } = useUser();
  const router = useRouter();
  // Anonymous Supabase session bootstrap is shared with the hero demo
  // widget on / via this hook; both call sites must agree on flow so a
  // visitor moving between pages doesn't double-sign-in.
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
    [user, router]
  );

  const fetchStreamingSummary = async function* ({
    queryKey,
    signal,
  }: QueryFunctionContext<
    [
      "youtube-summary-stream",
      string,
      boolean,
      SupportedLanguageCode | null,
    ]
  >): AsyncIterable<SummaryResult> {
    const [, urlArg, includeTranscriptArg, outputLanguageArg] = queryKey;
    debugLog("Fetching streaming summary:", {
      url: urlArg,
      includeTranscript: includeTranscriptArg,
      outputLanguage: outputLanguageArg,
    });

    // Get access token - either from user session or anonymous session
    const accessToken = session?.access_token || anonSession?.access_token;

    if (!accessToken) {
      throw new Error(
        "No authentication available. Please wait a moment while we set up anonymous access."
      );
    }

    const response = await fetch(
      "/api/summarize/stream",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          youtube_url: urlArg,
          include_transcript: includeTranscriptArg,
          // Only send the field when a translation is requested — the
          // server treats omitted === video-native (NULL cache row).
          ...(outputLanguageArg !== null
            ? { output_language: outputLanguageArg }
            : {}),
        }),
        signal,
      }
    );

    debugLog("Response status:", response.status);

    if (!response.ok) {
      let errorData: { message?: string; errorCode?: string; tier?: string; upgradeUrl?: string } = {};
      try {
        errorData = await response.json();
      } catch (parseErr) {
        console.error("[summarize-stream] non-JSON error body", {
          errorId: "SUMMARIZE_ERROR_BODY_PARSE_FAIL",
          status: response.status,
          parseErr,
        });
      }
      console.error("Error response:", errorData);
      if (response.status === 402) {
        throw new UpgradeRequiredError({
          errorCode: (errorData.errorCode as UpgradeRequiredError["errorCode"]) ?? "free_quota_exceeded",
          tier: (errorData.tier as UpgradeRequiredError["tier"]) ?? "free",
          upgradeUrl: errorData.upgradeUrl ?? "/pricing",
          message: errorData.message ?? "Upgrade required",
        });
      }
      if (response.status === 401 || response.status === 403) {
        handleAuthError(response.status, errorData.message ?? "");
      }
      throw new Error(
        errorData.message || "Failed to start streaming summarization"
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Failed to get response reader");
    }

    const decoder = new TextDecoder();
    let accumulatedData = "";
    let chunkCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        debugLog("Streaming finished. Total chunks:", chunkCount);
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      accumulatedData += chunk;
      chunkCount++;

      debugLog(`Chunk ${chunkCount}:`, chunk);

      // Yield raw accumulated data - let consumer parse it
      yield {
        title: "Streaming Summary",
        duration: "Streaming in progress",
        summary: accumulatedData,
        transcriptionTime: 0,
        summaryTime: 0,
      };
    }
  };

  // Streaming summarization query - with refetchMode to accumulate streaming results
  const queryOptions: UseQueryOptions<
    SummaryResult[],
    Error,
    SummaryResult[],
    [
      "youtube-summary-stream",
      string,
      boolean,
      SupportedLanguageCode | null,
    ]
  > = {
    queryKey: [
      "youtube-summary-stream",
      url,
      includeTranscript,
      outputLanguage,
    ],
    queryFn: streamedQuery({
      streamFn: fetchStreamingSummary,
    }),
    enabled: false,
    retry: 1,
  };

  const streamingSummarizationQuery = useQuery(queryOptions);

  return {
    summarizationQuery: streamingSummarizationQuery,
    isAnonymous: !session && !!anonSession,
    isAuthLoading: isLoading,
  };
}
