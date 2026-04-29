import { describe, expect, it } from "vitest";
import { buildChatMessages } from "../chat";

describe("buildChatMessages", () => {
  it("places summary + transcript inside the system message and history+user after", () => {
    const messages = buildChatMessages({
      transcript: "Welcome to the show. Today we discuss flow.",
      summary: "An intro to flow state.",
      history: [
        { id: "1", role: "user", content: "What's flow?", createdAt: "" },
        { id: "2", role: "assistant", content: "It is...", createdAt: "" },
      ],
      userMessage: "Quote the host.",
    });
    expect(messages).toHaveLength(4);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("An intro to flow state.");
    expect(messages[0]?.content).toContain("Welcome to the show.");
    expect(messages[1]).toEqual({ role: "user", content: "What's flow?" });
    expect(messages[2]).toEqual({ role: "assistant", content: "It is..." });
    expect(messages[3]).toEqual({ role: "user", content: "Quote the host." });
  });

  it("works with an empty history", () => {
    const messages = buildChatMessages({
      transcript: "T",
      summary: "S",
      history: [],
      userMessage: "Hi",
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]).toEqual({ role: "user", content: "Hi" });
  });

  it("includes the timestamp citation rule in the system prompt", () => {
    const messages = buildChatMessages({
      transcript: "T",
      summary: "S",
      history: [],
      userMessage: "Hi",
    });
    expect(messages[0]?.content).toMatch(/\[mm:ss\]/);
  });
});
