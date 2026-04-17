import { createClient } from "@/lib/supabase/server";
import { extractCaptions } from "@/lib/services/caption-extractor";
import { transcribeViaVps } from "@/lib/services/vps-client";
import {
  getCachedSummary,
  writeCachedSummary,
} from "@/lib/services/summarize-cache";
import { detectLanguage } from "@/lib/services/language-detect";
import { buildSummarizationPrompt } from "@/lib/prompts/summarization";
import { formatSseEvent, streamLlmSummary } from "@/lib/services/llm-client";
import { checkRateLimit } from "@/lib/services/rate-limit";

export const maxDuration = 300;

interface RequestBody {
  youtube_url: string;
  enable_thinking?: boolean;
  include_transcript?: boolean;
}

export async function POST(request: Request) {
  // Parse body
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return new Response(JSON.stringify({ message: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { youtube_url, enable_thinking = false, include_transcript = false } = body;

  if (!youtube_url || typeof youtube_url !== "string") {
    return new Response(
      JSON.stringify({ message: "youtube_url is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ message: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const isAnonymous = user.is_anonymous ?? false;

  // Rate limiting
  const { allowed, remaining } = await checkRateLimit(user.id, isAnonymous);
  if (!allowed) {
    return new Response(
      JSON.stringify({ message: "Rate limit exceeded. Please try again later." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": String(remaining),
        },
      }
    );
  }

  // Stream response
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: string) => controller.enqueue(encoder.encode(data));

      try {
        // Cache check
        const cached = await getCachedSummary(youtube_url, enable_thinking);

        if (cached) {
          send(
            formatSseEvent({
              type: "metadata",
              category: "general",
              cached: true,
            })
          );
          send(formatSseEvent({ type: "content", text: cached.summary }));
          if (enable_thinking && cached.thinking) {
            send(formatSseEvent({ type: "thinking", text: cached.thinking }));
          }
          if (include_transcript && cached.transcript) {
            send(
              formatSseEvent({
                type: "full_transcript",
                text: cached.transcript,
              })
            );
          }
          send(
            formatSseEvent({
              type: "summary",
              category: "general",
              total_time: cached.processingTime ?? 0,
              summarize_time: cached.processingTime ?? 0,
              transcribe_time: 0,
            })
          );
          controller.close();
          return;
        }

        const overallStart = Date.now();

        // Extract captions (fast path)
        send(
          formatSseEvent({
            type: "status",
            message: "Extracting captions...",
            stage: "transcribe",
          })
        );

        let transcript: string;
        let transcriptSource: string;

        const captions = await extractCaptions(youtube_url);

        if (captions) {
          transcript = captions.transcript;
          transcriptSource = captions.source;
        } else {
          // Whisper fallback via VPS
          send(
            formatSseEvent({
              type: "status",
              message: "No captions found. Transcribing audio...",
              stage: "transcribe",
            })
          );

          try {
            const vpsResult = await transcribeViaVps(youtube_url);
            transcript = vpsResult.transcript;
            transcriptSource = "whisper";
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "Transcription failed";
            send(
              formatSseEvent({
                type: "error",
                message: `Could not process this video: ${message}`,
              })
            );
            controller.close();
            return;
          }
        }

        // Detect language from transcript
        const language = detectLanguage(transcript.slice(0, 500));

        send(
          formatSseEvent({
            type: "status",
            message: `Detected language: ${language}`,
          })
        );

        if (include_transcript) {
          send(formatSseEvent({ type: "full_transcript", text: transcript }));
        }

        // Build prompt and stream LLM summary
        const prompt = buildSummarizationPrompt(transcript, language);

        let fullSummary = "";
        let fullThinking = "";

        for await (const event of streamLlmSummary({
          prompt,
          enableThinking: enable_thinking,
        })) {
          send(event);

          // Collect content and thinking chunks for caching
          const match = event.match(/^data: (.+)\n\n$/);
          if (match) {
            try {
              const parsed = JSON.parse(match[1]);
              if (parsed.type === "content" && typeof parsed.text === "string") {
                fullSummary += parsed.text;
              }
              if (parsed.type === "thinking" && typeof parsed.text === "string") {
                fullThinking += parsed.text;
              }
            } catch {
              // Skip
            }
          }
        }

        const overallDuration = (Date.now() - overallStart) / 1000;

        // Write to cache (non-blocking, fail silently)
        if (fullSummary) {
          writeCachedSummary({
            youtubeUrl: youtube_url,
            title: "",
            channelName: "",
            language,
            transcript,
            summary: fullSummary,
            thinking: fullThinking || null,
            transcriptSource,
            enableThinking: enable_thinking,
            model: process.env.LLM_MODEL || "claude-sonnet-4-6",
            processingTimeSeconds: overallDuration,
            userId: user.id,
          }).catch((err) => {
            console.error("Cache write error (non-fatal):", err);
          });
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "An unexpected error occurred";
        send(
          formatSseEvent({ type: "error", message: `Error: ${message}` })
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-RateLimit-Remaining": String(remaining),
    },
  });
}
