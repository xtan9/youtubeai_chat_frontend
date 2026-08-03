import type { SummaryResult, TranscriptSegment } from "@/lib/types";
import {
  parseSummarySsePayload,
  SummaryStreamProtocolError,
  type SummarySseEvent,
} from "@/lib/api-contracts/summary";

// Define the StreamingProgress interface
export interface StreamingProgress {
  stage: "preparing" | "transcribing" | "summarizing" | "complete";
  message: string;
  progress: number;
}

/**
 * Parse raw streaming data from the API and extract structured content and progress information
 *
 * @param rawData - The raw streaming data string from the API
 * @returns Object containing the parsed result and progress information
 */
export function parseStreamingData(rawData: string): {
  result: SummaryResult;
  progress: StreamingProgress | null;
  isCached: boolean;
  streamError: string | null;
  streamErrorId: string | null;
} {
  let accumulatedSummary = "";
  let title = "Streaming Summary";
  let duration = "Streaming in progress";
  let transcriptionTime = 0;
  let summaryTime = 0;
  let currentProgress: StreamingProgress | null = null;
  let segments: readonly TranscriptSegment[] | undefined;
  let isCached = false;
  // Server-emitted `{type: "error", message}` events surface here. Without
  // this hook the client silently drops error events and the progress bar
  // stalls at whatever stage was in flight — no feedback to the user.
  let streamError: string | null = null;
  let streamErrorId: string | null = null;
  let transcriptSource: SummaryResult["transcriptSource"];

  // Parse only complete SSE data lines. React Query yields the accumulated
  // wire buffer after every network chunk, so the final `data:` line can be
  // incomplete during an otherwise healthy stream.
  const lastFrameEnd = rawData.lastIndexOf("\n");
  const completeData =
    lastFrameEnd >= 0 ? rawData.slice(0, lastFrameEnd + 1) : "";
  const lines = completeData.split("\n");

  for (const line of lines) {
    if (line.startsWith("data:")) {
      try {
        const jsonStr = line.slice("data:".length).trim();

        const data: SummarySseEvent = parseSummarySsePayload(jsonStr);

        // Check for cached flag in metadata
        if (data.type === "metadata" && data.cached) {
          isCached = true;
        }

        // Handle only variants accepted by the shared runtime contract.
        switch (data.type) {
          case "metadata":
            title = data.category
              ? `${data.category} Summary`
              : "Video Summary";
            break;

          case "status": {
            const message = data.message.toLowerCase();
            const progressUpdate =
              message.includes("caption") || message.includes("subtitle")
                ? {
                    stage: "transcribing" as const,
                    message: data.message || "Processing captions...",
                    progress: 30,
                  }
                : message.includes("transcrib") || data.stage === "transcribe"
                  ? {
                      stage: "transcribing" as const,
                      message: data.message || "Transcribing audio...",
                      progress: 40,
                    }
                  : message.includes("summar") || data.stage === "summarize"
                    ? {
                        stage: "summarizing" as const,
                        message: data.message || "Generating summary...",
                        progress: 70,
                      }
                    : null;
            if (progressUpdate) {
              currentProgress = progressUpdate;
            }
            break;
          }

          case "content":
            if (data.text) {
              accumulatedSummary += data.text;
              currentProgress = {
                stage: "summarizing",
                message: "Generating summary...",
                progress: Math.min(95, 70 + accumulatedSummary.length / 50),
              };
            }
            break;

          case "full_transcript":
            segments = data.segments;
            transcriptSource = data.source;
            break;

          case "summary":
            // Final summary with timing info
            duration = `${data.total_time.toFixed(1)}s total`;
            transcriptionTime = data.transcribe_time;
            summaryTime = data.summarize_time;
            currentProgress = {
              stage: "complete",
              message: "Summary complete!",
              progress: 100,
            };
            break;

          case "error": {
            // Terminal state: capture the message for the banner and
            // advance progress to complete so the indicator stops
            // spinning. Without this the UI hangs at whatever stage
            // fired last (classically the 70% "Generating summary..."
            // state when the LLM call throws).
            const errorMessage =
              data.message || "Something went wrong. Please try again.";
            streamError = errorMessage;
            streamErrorId = data.errorId ?? null;
            currentProgress = {
              stage: "complete",
              message: errorMessage,
              progress: 100,
            };
            break;
          }
        }
      } catch (e) {
        if (e instanceof SummaryStreamProtocolError) throw e;
        // Skip invalid JSON lines
        console.warn("Failed to parse streaming data:", e);
      }
    }
  }

  // Fallback progress if no progress was determined
  if (!currentProgress) {
    currentProgress = {
      stage: "preparing",
      message: "Processing video...",
      progress: 10,
    };
  }

  return {
    result: {
      title,
      duration,
      summary: accumulatedSummary,
      transcriptionTime,
      summaryTime,
      segments,
      transcriptSource,
    },
    progress: currentProgress,
    isCached,
    streamError,
    streamErrorId,
  };
}

/**
 * Extracts the YouTube video ID from a YouTube URL.
 *
 * This function uses a regular expression to parse various YouTube URL formats
 * and extract the unique 11-character video identifier. It supports multiple
 * YouTube URL formats including:
 * - youtube.com/watch?v=VIDEO_ID
 * - youtu.be/VIDEO_ID
 * - youtube.com/embed/VIDEO_ID
 * - youtube.com/v/VIDEO_ID
 *
 * @param url - The YouTube URL to extract the video ID from
 * @returns The 11-character YouTube video ID, or null if no valid ID is found
 *
 * @example
 * ```typescript
 * getYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
 * // Returns: "dQw4w9WgXcQ"
 *
 * getYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ")
 * // Returns: "dQw4w9WgXcQ"
 *
 * getYoutubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")
 * // Returns: "dQw4w9WgXcQ"
 *
 * getYoutubeVideoId("invalid-url")
 * // Returns: null
 * ```
 */

export function getYoutubeVideoId(url: string) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);

  return match && match[2].length === 11 ? match[2] : null;
}

/**
 * Counts the number of words in a given text string.
 *
 * This function cleans the input text by trimming whitespace and normalizing
 * multiple consecutive whitespace characters into single spaces, then splits
 * the text on spaces to count individual words.
 *
 * @param text - The text string to count words in
 * @returns The number of words in the text, or 0 if the text is empty or contains only whitespace
 *
 * @example
 * ```typescript
 * countWords("Hello world")           // Returns: 2
 * countWords("  Multiple   spaces  ") // Returns: 2
 * countWords("")                      // Returns: 0
 * countWords("   ")                   // Returns: 0
 * ```
 */
export function countWords(text: string): number {
  const cleanText = text.trim().replace(/\s+/g, " ");
  if (!cleanText) return 0;

  // Handle Chinese characters (no spaces between characters)
  const chineseRegex = /[\u4e00-\u9fff]/g;
  const chineseChars = cleanText.match(chineseRegex);
  const chineseCount = chineseChars ? chineseChars.length : 0;

  // Handle non-Chinese text (split by spaces)
  const nonChineseText = cleanText.replace(chineseRegex, "");
  const nonChineseWords = nonChineseText.trim()
    ? nonChineseText.trim().split(/\s+/).length
    : 0;

  return chineseCount + nonChineseWords;
}
