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
import {
  TranscriptTimingNotice,
  type TranscriptTimingStatus,
} from "./transcript-timing-notice";
import { cn } from "@/lib/utils";

interface ChatTabProps {
  readonly youtubeUrl: string | null;
  readonly active: boolean;
  /**
   * Override the outer container classes. Lets the hero demo widget on `/`
   * use a shorter column height than `/summary`'s default `h-[640px]`.
   * When omitted, the original hardcoded height applies.
   */
  readonly className?: string;
  /**
   * Override the suggested-questions empty state. When provided, the
   * `/api/chat/suggestions` fetch is skipped — the override wins. Used
   * by the homepage hero demo to ship pre-bundled per-language
   * suggestions that swap when the demo's language picker changes.
   * Pass `undefined` (the default) on `/summary` to keep the existing
   * API-fetched behavior.
   */
  readonly suggestionsOverride?: readonly string[];
  readonly analyticsSurface?: "summary" | "hero_demo";
  readonly transcriptTimingStatus?: TranscriptTimingStatus;
  readonly onTimestampActivated?: () => void;
}

/**
 * Top-level orchestrator for the Chat tab. Mounts the persisted-thread
 * fetch only when the tab is active, so users who never click into chat
 * don't fire an extra request.
 */
export function ChatTab({
  youtubeUrl,
  active,
  className,
  suggestionsOverride,
  analyticsSurface = "summary",
  transcriptTimingStatus,
  onTimestampActivated,
}: ChatTabProps) {
  const [draftInput, setDraftInput] = useState("");
  // True while ChatClearButton is in its 5s undo window. We lock the
  // message input during the window — otherwise a message sent after
  // the optimistic clear would be erased by the deferred DELETE.
  const [clearPending, setClearPending] = useState(false);
  const thread = useChatThread(youtubeUrl, active);
  const stream = useChatStream({
    youtubeUrl,
    sourceSurface: analyticsSurface,
  });
  // Skip the API fetch when an override is provided — the demo never
  // wants the server-generated native-language suggestions.
  const suggestions = useChatSuggestions(
    youtubeUrl,
    active && suggestionsOverride === undefined,
  );
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

  const chatReturnTo =
    analyticsSurface === "hero_demo"
      ? "/"
      : youtubeUrl
        ? `/summary?url=${encodeURIComponent(youtubeUrl)}`
        : "/summary";

  // Count user-sent messages to drive the soft counter.
  const userMessageCount = persistedMessages.filter(
    (m) => m.role === "user",
  ).length;
  const FREE_CHAT_LIMIT = 5;
  const anonymousTrialEligible =
    analyticsSurface === "hero_demo" && ent?.tier === "anon";
  const anonymousTrial = anonymousTrialEligible
    ? ent.anonymousTrial
    : undefined;
  const anonymousTrialRemaining = anonymousTrialEligible
    ? stream.anonymousTrialRemaining ??
      (anonymousTrial?.state === "available"
        ? anonymousTrial.remainingMessages
        : null)
    : null;
  const anonymousTrialUnavailable =
    anonymousTrialEligible &&
    (stream.anonymousTrialUnavailable || anonymousTrial?.state === "unavailable");
  const anonymousTrialExhausted =
    anonymousTrialEligible &&
    (stream.upgradeError?.errorCode === "anonymous_trial_exhausted" ||
      anonymousTrialRemaining === 0);
  const visibleUpgradeError =
    stream.upgradeError?.errorCode === "anonymous_trial_exhausted" &&
    !anonymousTrialEligible
      ? null
      : stream.upgradeError;
  const chatCapBannerVariant =
    visibleUpgradeError?.errorCode === "anon_chat_blocked"
      ? "anon-blocked"
      : "free-cap";

  return (
    <div
      className={cn(
        "flex h-[640px] flex-col rounded-lg border border-border-default bg-surface-base",
        className,
      )}
    >
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

      {transcriptTimingStatus && transcriptTimingStatus !== "available" && (
        <div className="px-3 pt-3">
          <TranscriptTimingNotice
            status={transcriptTimingStatus}
            testId="chat-transcript-timing-notice"
          />
        </div>
      )}

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
          dynamicSuggestions={
            suggestionsOverride ?? suggestions.data?.suggestions
          }
        />
      ) : (
        <ChatMessageList
          messages={persistedMessages}
          draft={stream.draft}
          streaming={stream.streaming}
          transcriptTimingStatus={transcriptTimingStatus}
          onTimestampActivated={onTimestampActivated}
        />
      )}

      <div className="border-t border-border-subtle p-3">
        {anonymousTrialUnavailable ? (
          <ChatCapBanner
            variant="anonymous-trial-unavailable"
            returnTo={chatReturnTo}
          />
        ) : anonymousTrialExhausted ? (
          <ChatCapBanner
            variant="anonymous-trial-exhausted"
            returnTo={chatReturnTo}
          />
        ) : visibleUpgradeError ? (
          <ChatCapBanner
            variant={chatCapBannerVariant}
            returnTo={chatReturnTo}
          />
        ) : (
          <>
            <ChatInput
              value={draftInput}
              onChange={setDraftInput}
              onSend={handleSend}
              onStop={stream.abort}
              streaming={stream.streaming}
              disabled={!youtubeUrl || clearPending}
              maxLength={anonymousTrialRemaining !== null ? 500 : undefined}
            />
            {anonymousTrialRemaining !== null && (
              <p
                className="mt-2 text-center text-caption text-text-muted"
                aria-live="polite"
              >
                {anonymousTrialRemaining} Anonymous Trial{" "}
                {anonymousTrialRemaining === 1 ? "message" : "messages"}{" "}
                remaining
              </p>
            )}
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
