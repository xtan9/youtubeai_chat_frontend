import type { SummaryResult } from "@/lib/types";

// Define the StreamingProgress interface
export interface StreamingProgress {
  stage: "downloading" | "transcribing" | "summarizing" | "complete";
  message: string;
  progress: number;
  elapsed?: number;
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
} {
  let accumulatedSummary = "";
  let title = "Streaming Summary";
  let duration = "Streaming in progress";
  let transcriptionTime = 0;
  let summaryTime = 0;
  let currentProgress: StreamingProgress | null = null;

  // Parse Server-Sent Events format
  const lines = rawData.split("\n");

  // Track thinking content separately
  let thinkingContent = "";

  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        const jsonStr = line.slice(6).trim(); // Remove 'data: ' prefix and trim whitespace
        if (!jsonStr) continue; // Skip empty lines

        const data = JSON.parse(jsonStr);

        // Normalize data type to handle variations
        const type = (data.type || "").toLowerCase();

        // Determine progress based on multiple possible indicators
        const determineProgress = () => {
          const message = (data.message || "").toLowerCase();
          const stage = data.stage || "";

          if (message.includes("download") || stage === "download") {
            return {
              stage: "downloading" as const,
              message: data.message || "Downloading video...",
              progress: Math.min(30, 10 + (data.elapsed || 0) * 2),
              elapsed: data.elapsed,
            };
          }

          if (message.includes("caption") || message.includes("subtitle")) {
            return {
              stage: "transcribing" as const,
              message: data.message || "Processing captions...",
              progress: 30,
            };
          }

          if (message.includes("transcrib") || stage === "transcribe") {
            return {
              stage: "transcribing" as const,
              message: data.message || "Transcribing audio...",
              progress: 40,
            };
          }

          if (message.includes("summar") || stage === "summarize") {
            return {
              stage: "summarizing" as const,
              message: data.message || "Generating summary...",
              progress: 70,
            };
          }

          return null;
        };

        // Handle different types of streaming data
        switch (type) {
          case "metadata":
            title = data.category
              ? `${data.category} Summary`
              : "Video Summary";
            break;

          case "status":
          case "progress":
            const progressUpdate = determineProgress();
            if (progressUpdate) {
              currentProgress = progressUpdate;
            }
            break;

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

          case "thinking":
            if (data.text) {
              thinkingContent += data.text;
            }
            break;

          case "timing":
            if (data.stage === "total" || data.total_time) {
              duration = `${data.total_time?.toFixed(1) || 0}s total`;
              currentProgress = {
                stage: "complete",
                message: data.performance || "Summary complete!",
                progress: 100,
              };
            }
            break;

          case "summary":
            // Final summary with timing info
            duration = `${data.total_time?.toFixed(1) || 0}s total`;
            transcriptionTime = data.transcribe_time || 0;
            summaryTime = data.summarize_time || 0;
            currentProgress = {
              stage: "complete",
              message: data.performance || "Summary complete!",
              progress: 100,
            };
            break;
        }
      } catch (e) {
        // Skip invalid JSON lines
        console.warn("Failed to parse streaming data:", e);
      }
    }
  }

  // Fallback progress if no progress was determined
  if (!currentProgress) {
    currentProgress = {
      stage: "downloading",
      message: "Processing video...",
      progress: 10,
    };
  }

  return {
    result: {
      title,
      duration,
      summary: accumulatedSummary,
      keyPoints: thinkingContent ? [thinkingContent] : [],
      transcriptionTime,
      summaryTime,
    },
    progress: currentProgress,
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
