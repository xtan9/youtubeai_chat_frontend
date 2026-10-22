"use client";
import {
  ProjectGroundedSseEventSchema,
  type ProjectAnswerClassification,
  type ProjectGroundedSseEvent,
} from "@/lib/projects/project-grounded-answer-contract";

function parseEvent(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  try {
    const parsed = ProjectGroundedSseEventSchema.safeParse(
      JSON.parse(trimmed.slice(5).trim()),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function consumeProjectConversationStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ProjectGroundedSseEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseEvent(line);
      if (event) onEvent(event);
    }
  }
}

export function completionAnnouncement(classification: ProjectAnswerClassification) {
  if (classification === "supported") {
    return "Grounded Answer complete. Evidence supported.";
  }
  if (classification === "abstained") {
    return "Grounded Answer complete. Abstained.";
  }
  return "Grounded Answer complete. Unsupported by sources.";
}
