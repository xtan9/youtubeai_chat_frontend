"use client";

import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useClearChatThread } from "@/lib/hooks/useChatThread";

interface ChatClearButtonProps {
  readonly youtubeUrl: string | null;
  readonly disabled?: boolean;
  readonly onBeforeClear?: () => void;
}

/**
 * Wipes the persisted thread for the current (user, video). Confirms
 * via AlertDialog because the action is destructive and not undoable
 * in v1 (undo toast is a follow-up).
 */
export function ChatClearButton({
  youtubeUrl,
  disabled = false,
  onBeforeClear,
}: ChatClearButtonProps) {
  const mutation = useClearChatThread(youtubeUrl);

  const handleConfirm = async () => {
    onBeforeClear?.();
    try {
      await mutation.mutateAsync();
    } catch (err) {
      // Log so a Sentry/console breadcrumb ties the toast back to the
      // underlying server error class without a separate user report.
      console.error("[chat] clear failed", {
        errorId: "CHAT_CLEAR_UI_FAILED",
        youtubeUrl,
        err,
      });
      toast.error(err instanceof Error ? err.message : "Could not clear chat.");
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || mutation.isPending}
          aria-label="Clear chat history"
        >
          <Trash2 className="mr-1 size-4" />
          Clear
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear this chat?</AlertDialogTitle>
          <AlertDialogDescription>
            All messages for this video will be permanently removed. The video
            and summary stay.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>Clear</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
