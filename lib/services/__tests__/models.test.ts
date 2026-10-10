import { describe, it, expect } from "vitest";
import { HAIKU, SONNET, LUNA, type KnownModel } from "../models";

describe("models constants", () => {
  it("uses the configured GPT-6 Luna model", () => {
    expect(LUNA).toBe("gpt-6-luna");
  });

  it("keeps legacy routing aliases pointed at Luna", () => {
    expect(HAIKU).toBe(LUNA);
    expect(SONNET).toBe(LUNA);
  });

  it("KnownModel type accepts the Luna aliases", () => {
    // Compile-time guarantee, smoke-tested at runtime via assignability.
    const a: KnownModel = HAIKU;
    const b: KnownModel = SONNET;
    expect([a, b]).toEqual([LUNA, LUNA]);
  });
});
