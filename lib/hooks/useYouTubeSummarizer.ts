import { useUser } from "@/lib/contexts/user-context";

import type { SummaryResult } from "@/lib/types";
import { getAuthErrorInfo } from "@/lib/utils/youtube";
import {
  QueryFunctionContext,
  useQuery,
  experimental_streamedQuery as streamedQuery,
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

  const fetchRegularSummary = async ({
    queryKey,
    signal,
  }: QueryFunctionContext<
    ["youtube-summary", string]
  >): Promise<SummaryResult> => {
    if (!session?.access_token) {
      throw new Error("Authentication required. Please log in.");
    }
    const response = await fetch("https://api.youtubeai.chat/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        youtube_url: queryKey[1],
        enable_thinking: true,
      }),
      signal,
    });

    const data = await response.json();
    return {
      title: data.detected_category || "Video Summary",
      duration: `${data.timing?.total?.toFixed(1) || 0}s total`,
      summary: data.summary || "No summary available",
      keyPoints: [],
      transcriptionTime: data.timing?.transcribe || 0,
      summaryTime: data.timing?.summarize || 0,
    };
  };

  // Regular summarization query
  const summarizationQuery = useQuery({
    queryKey: ["youtube-summary", url],
    queryFn: fetchRegularSummary,
    enabled: false,
  });

  const fetchStreamingSummary = async function* ({
    queryKey,
    signal,
  }: QueryFunctionContext<
    ["youtube-summary-stream", string]
  >): AsyncIterable<SummaryResult> {
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

    if (!response.ok) {
      const errorData = await response.json();
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

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      accumulatedData += chunk;

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
  const streamingSummarizationQuery = useQuery({
    queryKey: ["youtube-summary-stream", url],
    queryFn: streamedQuery({
      queryFn: fetchStreamingSummary,
    }),
    enabled: false,
  });

  return {
    streamingSummarizationQuery,
    summarizationQuery,
  };
}
