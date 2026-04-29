"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ChatSuggestionsResponseSchema,
  type ChatSuggestionsResponse,
} from "@/lib/api-contracts/chat";

export type SuggestionsResponse = ChatSuggestionsResponse;

export const chatSuggestionsQueryKey = (youtubeUrl: string) =>
  ["chat-suggestions", youtubeUrl] as const;

/**
 * Lazy fetch of the per-video suggested follow-up questions used by the
 * chat tab's empty state. The route generates on first call and caches
 * on the summary row, so subsequent fetches across users / sessions
 * are fast.
 *
 * Pass `enabled: false` until the chat tab is active so visitors who
 * never click into chat don't fire an extra LLM-cost request.
 *
 * Failures resolve to `{ suggestions: [] }` rather than `isError` —
 * the empty state degrades to its static suggestion list instead of
 * rendering a banner, since dynamic suggestions are a nice-to-have.
 */
export function useChatSuggestions(youtubeUrl: string | null, enabled: boolean) {
  return useQuery<SuggestionsResponse>({
    queryKey: chatSuggestionsQueryKey(youtubeUrl ?? ""),
    queryFn: async ({ signal }) => {
      if (!youtubeUrl) return { suggestions: [] };
      const params = new URLSearchParams({ youtube_url: youtubeUrl });
      const res = await fetch(`/api/chat/suggestions?${params.toString()}`, {
        signal,
      });
      if (!res.ok) {
        // Log so a regression isn't invisible (the consumer falls back
        // to static suggestions silently).
        console.warn("[useChatSuggestions] fetch failed — using static fallback", {
          errorId: "CHAT_SUGGESTIONS_FETCH_FAILED",
          youtubeUrl,
          status: res.status,
        });
        return { suggestions: [] };
      }
      const raw = await res.json();
      const parsed = ChatSuggestionsResponseSchema.safeParse(raw);
      if (!parsed.success) {
        console.warn(
          "[useChatSuggestions] response schema drift — using static fallback",
          {
            errorId: "CHAT_SUGGESTIONS_SCHEMA_DRIFT",
            youtubeUrl,
            issues: parsed.error.issues,
          },
        );
        return { suggestions: [] };
      }
      return parsed.data;
    },
    enabled: !!youtubeUrl && enabled,
    // Generation can be slow (LLM round-trip); once fetched, the
    // suggestions are stable for this video — share across sessions
    // until the route's cache changes.
    staleTime: 5 * 60_000,
    // The route already returns 200 + `[]` on its own failure paths,
    // so retries only fire on a real 5xx (e.g. auth-service-unavailable
    // 503). Disabling them lets the static fallback show ~immediately
    // instead of after 3× exponential backoff — the empty state is a
    // nice-to-have, not load-bearing.
    retry: 0,
  });
}
