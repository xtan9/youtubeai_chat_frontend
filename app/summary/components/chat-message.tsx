"use client";

import { Fragment, type ReactNode } from "react";
import { parseCitations } from "@/lib/utils/timestamp-citations";
import { TimestampChip } from "./timestamp-chip";

interface ChatMessageProps {
  readonly role: "user" | "assistant";
  readonly content: string;
}

function renderContent(content: string): ReactNode {
  return parseCitations(content).map((part, idx) => {
    if (part.type === "timestamp") {
      return (
        <TimestampChip
          key={`ts-${idx}`}
          seconds={part.seconds}
          raw={part.raw}
        />
      );
    }
    return <Fragment key={`tx-${idx}`}>{part.value}</Fragment>;
  });
}

/**
 * Single chat bubble. Assistant messages get the timestamp-chip parser
 * applied; user messages render plain text — citations from the user
 * aren't actionable.
 */
export function ChatMessage({ role, content }: ChatMessageProps) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent-brand px-4 py-2 text-text-inverse">
          <p className="whitespace-pre-wrap text-body-md">{content}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-border-subtle bg-transparent px-4 py-2 text-text-primary">
        <p className="whitespace-pre-wrap text-body-md">{renderContent(content)}</p>
      </div>
    </div>
  );
}
