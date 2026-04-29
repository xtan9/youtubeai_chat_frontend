"use client";

import { useEffect, useRef, useState } from "react";
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
  /**
   * Called whenever the "clear is pending undo" status changes. Used by
   * the parent (chat-tab) to lock the message input during the 5s
   * window — otherwise a message sent after the optimistic clear would
   * be wiped out by the deferred server DELETE.
   */
  readonly onPendingChange?: (pending: boolean) => void;
}

const UNDO_WINDOW_MS = 5000;

/**
 * Wipes the persisted thread for the current (user, video) — optimistically.
 *
 * The clear is committed immediately in the local query cache (UI empties
 * at once) and a sonner toast offers a 5s undo. The actual server DELETE
 * is deferred to the toast's `onAutoClose`; clicking Undo restores the
 * snapshot to the cache and short-circuits the DELETE. No server-side
 * "restore" endpoint is needed.
 *
 * Reentrancy / race protection:
 *   - `pending` blocks a second click (and disables the button) so a
 *     rapid-fire double-click can't spawn two stacked toasts whose
 *     onAutoClose's both fire DELETEs.
 *   - The `undone` flag is a closure-local variable per `handleClear`
 *     call (NOT a shared ref) so a second click — once we allow one —
 *     can't clobber the first call's undo signal.
 *   - On unmount, if a clear is still pending and the user hasn't
 *     undone, we flush the DELETE eagerly. Without this an SPA route
 *     change during the 5s window would leave the success toast
 *     contradicting prod state ("Chat cleared" but server still has
 *     every message).
 */
export function ChatClearButton({
  youtubeUrl,
  disabled = false,
  onBeforeClear,
  onPendingChange,
}: ChatClearButtonProps) {
  const queryClient = useQueryClient();
  const mutation = useClearChatThread(youtubeUrl);
  const [pending, setPending] = useState(false);
  // Notify the parent about the pending status (input lock).
  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);

  // Refs that mirror the click-side state synchronously so the unmount
  // cleanup (which runs as a single mount-time effect) can observe the
  // latest values without depending on a state-sync effect: pendingRef
  // says "is a clear still waiting on its DELETE?" and flushClearRef
  // holds the closure captured by the most recent `handleClear` call
  // (snapshot, queryKey, and `undone` flag).
  const pendingRef = useRef(false);
  const flushClearRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (pendingRef.current) {
        flushClearRef.current?.();
      }
    };
  }, []);

  const handleClear = () => {
    if (pending) return;
    if (!youtubeUrl) return;
    onBeforeClear?.();

    const queryKey = chatThreadQueryKey(youtubeUrl);
    const snapshot =
      queryClient.getQueryData<ChatMessagesResponse>(queryKey);
    queryClient.setQueryData<ChatMessagesResponse>(queryKey, { messages: [] });
    pendingRef.current = true;
    setPending(true);
    let undone = false;

    const fireDelete = () => {
      mutation.mutate(undefined, {
        onError: (err) => {
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
    };

    flushClearRef.current = () => {
      if (undone) return;
      undone = true;
      fireDelete();
    };

    toast.success("Chat cleared", {
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Undo",
        onClick: () => {
          undone = true;
          pendingRef.current = false;
          setPending(false);
          flushClearRef.current = null;
          if (snapshot) {
            queryClient.setQueryData<ChatMessagesResponse>(queryKey, snapshot);
          }
        },
      },
      onAutoClose: () => {
        if (undone) return;
        undone = true;
        pendingRef.current = false;
        setPending(false);
        flushClearRef.current = null;
        fireDelete();
      },
    });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled || pending || mutation.isPending}
      // Announce the undo affordance up-front so screen-reader users
      // know the destructive action is recoverable before activating.
      aria-label="Clear chat history (5 second undo)"
      onClick={handleClear}
    >
      <Trash2 className="mr-1 size-4" />
      Clear
    </Button>
  );
}
