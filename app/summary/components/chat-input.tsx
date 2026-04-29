"use client";

import { type KeyboardEvent, useEffect, useRef } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSend: () => void;
  readonly onStop: () => void;
  readonly streaming: boolean;
  readonly disabled?: boolean;
  readonly placeholder?: string;
}

/**
 * Composer for the chat tab. Send is replaced with Stop while a stream
 * is in flight so the user can cancel a long answer. Enter submits;
 * Shift+Enter inserts a newline (matches the standard chat-input idiom).
 */
export function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  disabled = false,
  placeholder = "Ask a question about this video…",
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow up to a reasonable cap so a long question doesn't push the
  // send button off the bottom of the panel.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${next}px`;
  }, [value]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!streaming && !disabled && value.trim().length > 0) {
        onSend();
      }
    }
  };

  return (
    <div className="flex items-end gap-2 rounded-2xl border border-border-default bg-surface-base p-2 focus-within:ring-2 focus-within:ring-state-focus">
      <Textarea
        ref={textareaRef}
        value={value}
        rows={1}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 resize-none border-0 bg-transparent p-2 text-body-md focus-visible:ring-0 focus-visible:ring-offset-0"
        aria-label="Chat message"
      />
      {streaming ? (
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={onStop}
          aria-label="Stop generating"
          className="rounded-full"
        >
          <Square className="size-2.5 fill-current" />
        </Button>
      ) : (
        <Button
          type="button"
          size="icon"
          onClick={() => onSend()}
          disabled={disabled || value.trim().length === 0}
          aria-label="Send message"
        >
          <Send className="size-4" />
        </Button>
      )}
    </div>
  );
}
