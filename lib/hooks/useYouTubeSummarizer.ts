import { useUser } from "@/lib/contexts/user-context";
import { createClient } from "@/lib/supabase/client";

import type { SummaryResult } from "@/lib/types";
import { getAuthErrorInfo } from "@/lib/utils/youtube";
import {
  QueryFunctionContext,
  useQuery,
  experimental_streamedQuery as streamedQuery,
  UseQueryOptions,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useState, useEffect } from "react";

const debugLog: (...args: unknown[]) => void =
  process.env.NODE_ENV === "production" ? () => {} : console.log;

export function useYouTubeSummarizer(
  url: string,
  includeTranscript: boolean = true
) {
  const { user, session } = useUser();
  const router = useRouter();
  const [anonSession, setAnonSession] = useState<{
    access_token: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Get an anonymous session if user is not logged in
  useEffect(() => {
    async function getAnonymousSession() {
      if (!session && !anonSession && !isLoading) {
        setIsLoading(true);
        try {
          const supabase = createClient();

          // Check if we already have an anonymous session
          const { data: sessionData } = await supabase.auth.getSession();

          if (sessionData?.session) {
            debugLog("Using existing anonymous session");
            setAnonSession(sessionData.session);
          } else {
            debugLog("Signing in anonymously");
            const { data, error } = await supabase.auth.signInAnonymously();

            if (error) {
              console.error("Anonymous sign-in error:", error);
            } else if (data?.session) {
              debugLog("Anonymous sign-in successful");
              setAnonSession(data.session);
            }
          }
        } catch (error) {
          console.error("Error during anonymous authentication:", error);
        } finally {
          setIsLoading(false);
        }
      }
    }

    getAnonymousSession();
  }, [session, anonSession, isLoading]);

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
    ["youtube-summary-stream", string, boolean]
  >): AsyncIterable<SummaryResult> {
    debugLog("Fetching streaming summary:", {
      url: queryKey[1],
      includeTranscript: queryKey[2],
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
          youtube_url: queryKey[1],
          include_transcript: queryKey[2] || false,
        }),
        signal,
      }
    );

    debugLog("Response status:", response.status);

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Error response:", errorData);
      if (response.status === 401 || response.status === 403) {
        handleAuthError(response.status, errorData.message);
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
        keyPoints: [],
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
    ["youtube-summary-stream", string, boolean]
  > = {
    queryKey: ["youtube-summary-stream", url, includeTranscript],
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
