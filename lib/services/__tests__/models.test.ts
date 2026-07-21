import { describe, it, expect } from "vitest";
import { HAIKU, SONNET, type KnownModel } from "../models";

describe("models constants", () => {
  it("uses the allowlisted low-cost OpenAI model", () => {
    expect(HAIKU).toBe("gpt-5.4-mini");
  });

  it("uses the allowlisted quality OpenAI model", () => {
    expect(SONNET).toBe("gpt-5.6-sol");
  });

  it("HAIKU and SONNET are distinct", () => {
    expect(HAIKU).not.toBe(SONNET);
  });

  it("KnownModel type accepts both constants", () => {
    // Compile-time guarantee, smoke-tested at runtime via assignability
    const a: KnownModel = HAIKU;
    const b: KnownModel = SONNET;
    expect([a, b]).toHaveLength(2);
  });
});
