import { describe, it, expect } from "vitest";
import { HAIKU, SONNET, SOL, type KnownModel } from "../models";

describe("models constants", () => {
  it("uses the configured GPT-6.2 Sol model", () => {
    expect(SOL).toBe("gpt-6.2-sol");
  });

  it("keeps legacy routing aliases pointed at Sol", () => {
    expect(HAIKU).toBe(SOL);
    expect(SONNET).toBe(SOL);
  });

  it("KnownModel type accepts the Sol aliases", () => {
    // Compile-time guarantee, smoke-tested at runtime via assignability.
    const a: KnownModel = HAIKU;
    const b: KnownModel = SONNET;
    expect([a, b]).toEqual([SOL, SOL]);
  });
});
