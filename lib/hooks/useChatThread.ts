"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChatMessagesResponseSchema,
  type ChatMessagesResponse,
} from "@/lib/api-contracts/chat";

export type { ChatMessage } from "@/lib/api-contracts/chat";

export const chatThreadQueryKey = (youtubeUrl: string) =>
  ["chat-thread", youtubeUrl] as const;

/**
 * Lazy fetch of the persisted chat thread for the current user + URL.
 * Pass `enabled: false` until the user opens the Chat tab so visitors who
 * never click into chat don't fire an extra request.
 */
export function useChatThread(
  youtubeUrl: string | null,
  enabled: boolean
) {
  return useQuery<ChatMessagesResponse, Error>({
    queryKey: chatThreadQueryKey(youtubeUrl ?? ""),
    queryFn: async ({ signal }) => {
      if (!youtubeUrl) return { messages: [] };
      const params = new URLSearchParams({ youtube_url: youtubeUrl });
      const res = await fetch(`/api/chat/messages?${params.toString()}`, {
        signal,
      });
      if (!res.ok) {
        let message = "Failed to load chat history.";
        try {
          const body = (await res.json()) as { message?: string };
          if (body?.message) message = body.message;
        } catch {
          // body wasn't JSON — keep the default message
        }
        throw new Error(message);
      }
      // Validate the response shape against the shared contract so a
      // server-side schema drift surfaces as a query error (which the
      // chat tab renders as a banner) instead of silently rendering
      // corrupted bubbles.
      const raw = await res.json();
      const parsed = ChatMessagesResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error("Chat history response was malformed.");
      }
      return parsed.data;
    },
    enabled: !!youtubeUrl && enabled,
    staleTime: 30_000,
  });
}

/**
 * Imperative clear: DELETE the thread, then refresh the cached query so
 * the chat tab re-renders empty. Safe to call even when the cache has
 * never been fetched — the invalidate is a no-op then.
 */
export function useClearChatThread(youtubeUrl: string | null) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      if (!youtubeUrl) return;
      const params = new URLSearchParams({ youtube_url: youtubeUrl });
      const res = await fetch(`/api/chat/messages?${params.toString()}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        let message = "Could not clear chat history.";
        try {
          const body = (await res.json()) as { message?: string };
          if (body?.message) message = body.message;
        } catch {
          // body wasn't JSON — keep default
        }
        throw new Error(message);
      }
    },
    onSuccess: async () => {
      if (!youtubeUrl) return;
      queryClient.setQueryData(chatThreadQueryKey(youtubeUrl), { messages: [] });
      await queryClient.invalidateQueries({
        queryKey: chatThreadQueryKey(youtubeUrl),
      });
    },
  });
}
