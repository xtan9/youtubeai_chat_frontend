"use client";

import { useCallback, useState } from "react";
import { useChatStream } from "@/lib/hooks/useChatStream";
import { useChatSuggestions } from "@/lib/hooks/useChatSuggestions";
import { useChatThread } from "@/lib/hooks/useChatThread";
import { useEntitlements } from "@/lib/hooks/useEntitlements";
import { ChatCapBanner } from "@/components/paywall/ChatCapBanner";
import { ChatCapCounter } from "@/components/paywall/ChatCapCounter";
import { ChatClearButton } from "./chat-clear-button";
import { ChatEmptyState } from "./chat-empty-state";
import { ChatInput } from "./chat-input";
import { ChatMessageList } from "./chat-message-list";

interface ChatTabProps {
  readonly youtubeUrl: string | null;
  readonly active: boolean;
}

/**
 * Top-level orchestrator for the Chat tab. Mounts the persisted-thread
 * fetch only when the tab is active, so users who never click into chat
 * don't fire an extra request.
 */
export function ChatTab({ youtubeUrl, active }: ChatTabProps) {
  const [draftInput, setDraftInput] = useState("");
  // True while ChatClearButton is in its 5s undo window. We lock the
  // message input during the window — otherwise a message sent after
  // the optimistic clear would be erased by the deferred DELETE.
  const [clearPending, setClearPending] = useState(false);
  const thread = useChatThread(youtubeUrl, active);
  const stream = useChatStream({ youtubeUrl });
  const suggestions = useChatSuggestions(youtubeUrl, active);
  const { data: ent } = useEntitlements();

  const handleSend = () => {
    const text = draftInput.trim();
    if (!text || clearPending) return;
    setDraftInput("");
    void stream.send(text);
  };
  const handleClearPendingChange = useCallback((pending: boolean) => {
    setClearPending(pending);
  }, []);

  const handlePickSuggestion = (suggestion: string) => {
    setDraftInput(suggestion);
  };

  const handleBeforeClear = () => {
    stream.abort();
  };

  const persistedMessages = thread.data?.messages ?? [];
  const showEmptyState =
    !thread.isLoading &&
    persistedMessages.length === 0 &&
    !stream.draft &&
    !stream.streaming;

  // Determine the chat cap banner variant based on the 402 error code.
  const chatCapBannerVariant =
    stream.upgradeError?.errorCode === "anon_chat_blocked"
      ? "anon-blocked"
      : "free-cap";

  // Count user-sent messages to drive the soft counter.
  const userMessageCount = persistedMessages.filter(
    (m) => m.role === "user",
  ).length;
  const FREE_CHAT_LIMIT = 5;

  return (
    <div className="flex h-[640px] flex-col rounded-lg border border-border-default bg-surface-base">
      <div className="flex items-center justify-between border-b border-border-subtle p-2">
        <span className="px-2 text-body-sm font-medium text-text-secondary">
          Chat about this video
        </span>
        <ChatClearButton
          youtubeUrl={youtubeUrl}
          disabled={persistedMessages.length === 0 && !stream.draft}
          onBeforeClear={handleBeforeClear}
          onPendingChange={handleClearPendingChange}
        />
      </div>

      {thread.error && (
        <div
          role="alert"
          className="m-3 rounded-md border border-accent-danger bg-surface-raised p-3 text-body-sm text-accent-danger"
        >
          {thread.error.message}
        </div>
      )}
      {stream.error && (
        <div
          role="alert"
          className="m-3 rounded-md border border-accent-danger bg-surface-raised p-3 text-body-sm text-accent-danger"
        >
          {stream.error}
        </div>
      )}

      {showEmptyState ? (
        <ChatEmptyState
          onPickSuggestion={handlePickSuggestion}
          dynamicSuggestions={suggestions.data?.suggestions}
        />
      ) : (
        <ChatMessageList
          messages={persistedMessages}
          draft={stream.draft}
          streaming={stream.streaming}
        />
      )}

      <div className="border-t border-border-subtle p-3">
        {stream.upgradeError ? (
          <ChatCapBanner variant={chatCapBannerVariant} />
        ) : (
          <>
            <ChatInput
              value={draftInput}
              onChange={setDraftInput}
              onSend={handleSend}
              onStop={stream.abort}
              streaming={stream.streaming}
              disabled={!youtubeUrl || clearPending}
            />
            {ent?.tier === "free" && (
              <ChatCapCounter
                used={userMessageCount}
                limit={FREE_CHAT_LIMIT}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
