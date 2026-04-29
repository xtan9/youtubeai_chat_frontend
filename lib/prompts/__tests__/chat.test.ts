import { describe, expect, it } from "vitest";
import { buildChatMessages } from "../chat";

describe("buildChatMessages", () => {
  it("front-loads context as a synthetic user→assistant primer, then history, then new question", () => {
    const messages = buildChatMessages({
      transcript: "Welcome to the show. Today we discuss flow.",
      summary: "An intro to flow state.",
      history: [
        { id: "1", role: "user", content: "What's flow?", createdAt: "" },
        { id: "2", role: "assistant", content: "It is...", createdAt: "" },
      ],
      userMessage: "Quote the host.",
    });
    // 1 primer-user + 1 primer-ack + 2 history + 1 new user = 5
    expect(messages).toHaveLength(5);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toContain("An intro to flow state.");
    expect(messages[0]?.content).toContain("Welcome to the show.");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.content).toMatch(/grounded in the transcript/i);
    expect(messages[2]).toEqual({ role: "user", content: "What's flow?" });
    expect(messages[3]).toEqual({ role: "assistant", content: "It is..." });
    expect(messages[4]).toEqual({ role: "user", content: "Quote the host." });
  });

  it("works with an empty history (primer + ack + new user = 3 messages)", () => {
    const messages = buildChatMessages({
      transcript: "T",
      summary: "S",
      history: [],
      userMessage: "Hi",
    });
    expect(messages).toHaveLength(3);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[2]).toEqual({ role: "user", content: "Hi" });
  });

  it("includes the timestamp citation rule in the primer", () => {
    const messages = buildChatMessages({
      transcript: "T",
      summary: "S",
      history: [],
      userMessage: "Hi",
    });
    expect(messages[0]?.content).toMatch(/\[mm:ss\]/);
  });

  it("does NOT use a system-role message (gateway-strip avoidance)", () => {
    // The OpenAI-compat gateway in front of Claude is unreliable about
    // forwarding system-role messages — empirically the model answered
    // "I don't see any content to summarize" when transcript lived in
    // a system message. Pinning that we never emit one prevents a
    // future refactor from regressing the fix.
    const messages = buildChatMessages({
      transcript: "T",
      summary: "S",
      history: [],
      userMessage: "Hi",
    });
    expect(messages.every((m) => m.role !== "system")).toBe(true);
  });

  it("emits the primer as a plain string (no cache_control) when cacheStablePrefix is omitted or false", () => {
    const messages = buildChatMessages({
      transcript: "T",
      summary: "S",
      history: [],
      userMessage: "Hi",
    });
    expect(typeof messages[0]?.content).toBe("string");
  });

  it("emits the primer as a content-array tagged with cache_control: ephemeral when cacheStablePrefix is true", () => {
    const messages = buildChatMessages({
      transcript: "Welcome to the show.",
      summary: "Intro.",
      history: [],
      userMessage: "Hi",
      cacheStablePrefix: true,
    });
    const primer = messages[0];
    expect(primer?.role).toBe("user");
    expect(Array.isArray(primer?.content)).toBe(true);
    const blocks = primer?.content as Array<{
      type: string;
      text: string;
      cache_control?: { type: string };
    }>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("text");
    expect(blocks[0]?.text).toContain("Welcome to the show.");
    expect(blocks[0]?.text).toContain("Intro.");
    expect(blocks[0]?.cache_control).toEqual({ type: "ephemeral" });
    // Only the primer carries cache_control — the assistant ack, history,
    // and the new user question stay as plain strings so the cache
    // breakpoint is exactly at the end of the long stable prefix.
    expect(typeof messages[1]?.content).toBe("string");
    expect(typeof messages[2]?.content).toBe("string");
  });
});
