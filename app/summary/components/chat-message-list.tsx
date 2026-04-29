"use client";

import { useEffect, useRef } from "react";
import { ChatMessage } from "./chat-message";
import type { ChatMessage as ChatMessageRow } from "@/lib/hooks/useChatThread";

interface ChatMessageListProps {
  readonly messages: readonly ChatMessageRow[];
  readonly draft: { user: string; assistant: string } | null;
  readonly streaming: boolean;
}

/**
 * Renders the persisted thread followed by the in-flight draft (if any).
 * Auto-scrolls to bottom on every new content arrival unless the user
 * has scrolled up — that condition is approximated by checking whether
 * the scroller is within 80px of the bottom before pushing.
 */
export function ChatMessageList({
  messages,
  draft,
  streaming,
}: ChatMessageListProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    if (distanceFromBottom < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, draft]);

  return (
    <div
      ref={scrollerRef}
      className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
      data-testid="chat-message-list"
    >
      {messages.map((m) => (
        <ChatMessage key={m.id} role={m.role} content={m.content} />
      ))}
      {draft && (
        <>
          <ChatMessage role="user" content={draft.user} />
          {draft.assistant.length > 0 ? (
            <ChatMessage role="assistant" content={draft.assistant} />
          ) : streaming ? (
            <ThinkingIndicator />
          ) : null}
        </>
      )}
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex justify-start" data-testid="chat-thinking-indicator">
      <div
        role="status"
        aria-live="polite"
        aria-label="Assistant is thinking"
        className="rounded-2xl rounded-bl-sm border border-border-subtle bg-transparent px-4 py-3"
      >
        <span className="flex items-center gap-1">
          <span className="size-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:0ms]" />
          <span className="size-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:150ms]" />
          <span className="size-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:300ms]" />
        </span>
      </div>
    </div>
  );
}
