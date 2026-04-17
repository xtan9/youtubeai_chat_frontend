import { describe, it, expect } from "vitest";
import { formatSseEvent } from "../llm-client";

describe("formatSseEvent", () => {
  it("formats an SSE event with type and data", () => {
    const event = formatSseEvent({ type: "content", text: "hello" });
    expect(event).toBe('data: {"type":"content","text":"hello"}\n\n');
  });

  it("formats metadata event", () => {
    const event = formatSseEvent({
      type: "metadata",
      category: "general",
      cached: false,
    });
    expect(event).toContain('"type":"metadata"');
    expect(event).toContain('"cached":false');
    expect(event.endsWith("\n\n")).toBe(true);
  });
});
