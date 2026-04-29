"use client";

import { useRef } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  chatThreadQueryKey,
  useClearChatThread,
} from "@/lib/hooks/useChatThread";
import type { ChatMessagesResponse } from "@/lib/api-contracts/chat";

interface ChatClearButtonProps {
  readonly youtubeUrl: string | null;
  readonly disabled?: boolean;
  readonly onBeforeClear?: () => void;
}

const UNDO_WINDOW_MS = 5000;

/**
 * Wipes the persisted thread for the current (user, video) — optimistically.
 *
 * The clear is committed immediately in the local query cache (so the UI
 * empties at once) and a sonner toast offers a 5s undo. The actual server
 * DELETE is deferred until the toast auto-closes; clicking Undo restores
 * the snapshot to the cache and cancels the pending DELETE. This is the
 * standard "optimistic delete with undo" pattern — no server-side
 * "restore" endpoint needed.
 */
export function ChatClearButton({
  youtubeUrl,
  disabled = false,
  onBeforeClear,
}: ChatClearButtonProps) {
  const queryClient = useQueryClient();
  const mutation = useClearChatThread(youtubeUrl);
  // Tracks whether the *currently-open* undo toast was undone. Sonner's
  // `onAutoClose` runs whether or not the action was clicked; without
  // this flag the DELETE would fire even after a user clicked Undo.
  const undoneRef = useRef(false);

  const handleClear = () => {
    if (!youtubeUrl) return;
    onBeforeClear?.();

    const queryKey = chatThreadQueryKey(youtubeUrl);
    const snapshot =
      queryClient.getQueryData<ChatMessagesResponse>(queryKey);
    queryClient.setQueryData<ChatMessagesResponse>(queryKey, { messages: [] });
    undoneRef.current = false;

    toast.success("Chat cleared", {
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Undo",
        onClick: () => {
          undoneRef.current = true;
          if (snapshot) {
            queryClient.setQueryData<ChatMessagesResponse>(queryKey, snapshot);
          }
        },
      },
      onAutoClose: () => {
        if (undoneRef.current) return;
        mutation.mutate(undefined, {
          onError: (err) => {
            // Rollback if the server rejected the delete — the user
            // already saw the messages disappear, so failing silently
            // here would leave them confused about whether the clear
            // landed.
            if (snapshot) {
              queryClient.setQueryData<ChatMessagesResponse>(queryKey, snapshot);
            }
            console.error("[chat] clear failed", {
              errorId: "CHAT_CLEAR_UI_FAILED",
              youtubeUrl,
              err,
            });
            toast.error(
              err instanceof Error ? err.message : "Could not clear chat.",
            );
          },
        });
      },
    });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled || mutation.isPending}
      aria-label="Clear chat history"
      onClick={handleClear}
    >
      <Trash2 className="mr-1 size-4" />
      Clear
    </Button>
  );
}
