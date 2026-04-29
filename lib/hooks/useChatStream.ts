"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/lib/contexts/user-context";
import { createClient } from "@/lib/supabase/client";
import { chatThreadQueryKey } from "./useChatThread";
import {
  ChatSseEventSchema,
  type ChatSseEvent,
} from "@/lib/api-contracts/chat";

interface UseChatStreamArgs {
  readonly youtubeUrl: string | null;
}

export interface ChatStreamApi {
  readonly send: (message: string) => Promise<void>;
  readonly abort: () => void;
  readonly streaming: boolean;
  readonly draft: { readonly user: string; readonly assistant: string } | null;
  readonly error: string | null;
}

const MAX_PARSE_WARNINGS_PER_STREAM = 3;

function parseSseLine(
  line: string,
  warnState: { count: number }
): ChatSseEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (payload.length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch (err) {
    if (warnState.count < MAX_PARSE_WARNINGS_PER_STREAM) {
      warnState.count++;
      console.warn("[useChatStream] malformed SSE chunk", {
        errorId: "CHAT_SSE_PARSE_FAILED",
        err,
        payloadExcerpt: payload.slice(0, 80),
      });
    }
    return null;
  }
  const parsed = ChatSseEventSchema.safeParse(raw);
  if (!parsed.success) {
    if (warnState.count < MAX_PARSE_WARNINGS_PER_STREAM) {
      warnState.count++;
      console.warn("[useChatStream] unknown SSE event shape", {
        errorId: "CHAT_SSE_UNKNOWN_EVENT",
        issues: parsed.error.issues,
        payloadExcerpt: payload.slice(0, 80),
      });
    }
    return null;
  }
  return parsed.data;
}

/**
 * Imperative chat-stream hook. Owns the draft user/assistant pair while a
 * stream is in flight; on completion, invalidates the persisted-thread
 * query so the next render reads the canonical row from the server and
 * the draft is cleared.
 */
export function useChatStream({ youtubeUrl }: UseChatStreamArgs): ChatStreamApi {
  const { session } = useUser();
  const queryClient = useQueryClient();
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState<
    { user: string; assistant: string } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (message: string) => {
      if (!youtubeUrl || message.trim().length === 0) return;
      // Don't allow concurrent sends — Stop must be pressed first.
      if (abortRef.current) return;

      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setStreaming(true);
      setDraft({ user: message, assistant: "" });

      // Resolve auth: prefer the live session; otherwise pick up the
      // anonymous session established earlier on the same page (the
      // summary tab's hook calls signInAnonymously on mount, so by the
      // time chat is reachable we expect a session to exist). If the
      // session lookup fails or returns nothing, surface a clear "wait"
      // error rather than firing an unauthenticated fetch and showing
      // a generic 401 toast.
      let accessToken = session?.access_token ?? null;
      if (!accessToken) {
        try {
          const supabase = createClient();
          const { data } = await supabase.auth.getSession();
          accessToken = data.session?.access_token ?? null;
        } catch (err) {
          // Auth client itself failed — log so a Sentry breadcrumb ties
          // the user-visible "wait" message back to the underlying
          // cause without a separate report.
          console.error("[useChatStream] getSession threw", {
            errorId: "CHAT_GET_SESSION_THREW",
            err,
          });
          accessToken = null;
        }
      }
      if (!accessToken) {
        setStreaming(false);
        setDraft(null);
        abortRef.current = null;
        setError(
          "Setting up your session… please try again in a moment."
        );
        return;
      }

      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ youtube_url: youtubeUrl, message }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let serverMessage = "Could not send message.";
          try {
            const body = (await response.json()) as { message?: string };
            if (body?.message) serverMessage = body.message;
          } catch {
            // non-JSON error body — keep default
          }
          throw new Error(serverMessage);
        }
        if (!response.body) {
          throw new Error("Empty response from server.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const warnState = { count: 0 };
        let buffer = "";
        let receivedAny = false;
        let assistantText = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const evt = parseSseLine(line, warnState);
            if (!evt) continue;
            if (evt.type === "delta") {
              receivedAny = true;
              assistantText += evt.text;
              setDraft({ user: message, assistant: assistantText });
            } else if (evt.type === "error") {
              throw new Error(evt.message);
            } else {
              // done
            }
          }
        }
        if (!receivedAny) {
          throw new Error("No response received.");
        }
      } catch (err) {
        // AbortError from our own controller is expected when the user
        // pressed Stop — keep whatever we already streamed visible and
        // don't surface as an error.
        const aborted =
          (err instanceof DOMException && err.name === "AbortError") ||
          controller.signal.aborted;
        if (!aborted) {
          const msg = err instanceof Error ? err.message : "Could not send message.";
          setError(msg);
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        // Re-fetch the canonical thread; the draft is cleared on the
        // next render once the persisted message replaces it.
        if (youtubeUrl) {
          await queryClient.invalidateQueries({
            queryKey: chatThreadQueryKey(youtubeUrl),
          });
        }
        setDraft(null);
      }
    },
    [youtubeUrl, session, queryClient]
  );

  return { send, abort, streaming, draft, error };
}
