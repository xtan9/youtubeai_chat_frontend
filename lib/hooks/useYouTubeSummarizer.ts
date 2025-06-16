import { useUser } from "@/lib/contexts/user-context";

import type { SummaryResult } from "@/lib/types";
import { getAuthErrorInfo } from "@/lib/utils/youtube";
import {
  QueryFunctionContext,
  useQuery,
  experimental_streamedQuery as streamedQuery,
  UseQueryOptions,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

export function useYouTubeSummarizer(url: string) {
  const { user, session } = useUser();
  const router = useRouter();

  const handleAuthError = useCallback(
    (status: number, message: string) => {
      const errorInfo = getAuthErrorInfo(status, message);

      if (errorInfo.shouldRedirect && user) {
        setTimeout(() => {
          router.push("/auth");
        }, errorInfo.redirectDelay);
      }
    },
    [user, router]
  );

  const fetchStreamingSummary = async function* ({
    queryKey,
    signal,
  }: QueryFunctionContext<
    ["youtube-summary-stream", string]
  >): AsyncIterable<SummaryResult> {
    console.log("Fetching streaming summary for URL:", queryKey[1]);

    if (!session?.access_token) {
      throw new Error("Authentication required. Please log in.");
    }

    const response = await fetch(
      "https://api.youtubeai.chat/summarize/stream",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ youtube_url: queryKey[1] }),
        signal,
      }
    );

    console.log("Response status:", response.status);

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
        console.log("Streaming finished. Total chunks:", chunkCount);
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      accumulatedData += chunk;
      chunkCount++;

      console.log(`Chunk ${chunkCount}:`, chunk);

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
    ["youtube-summary-stream", string]
  > = {
    queryKey: ["youtube-summary-stream", url],
    queryFn: streamedQuery({
      queryFn: fetchStreamingSummary,
    }),
    enabled: false,
    retry: 1,
  };

  const streamingSummarizationQuery = useQuery(queryOptions);

  return {
    summarizationQuery: streamingSummarizationQuery,
  };
}
