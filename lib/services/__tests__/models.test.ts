import { describe, it, expect } from "vitest";
import { HAIKU, SONNET, SPARK, type KnownModel } from "../models";

describe("models constants", () => {
  it("uses the configured Codex Spark model", () => {
    expect(SPARK).toBe("gpt-5.3-codex-spark");
  });

  it("keeps legacy routing aliases pointed at Spark", () => {
    expect(HAIKU).toBe(SPARK);
    expect(SONNET).toBe(SPARK);
  });

  it("KnownModel type accepts the Spark aliases", () => {
    // Compile-time guarantee, smoke-tested at runtime via assignability.
    const a: KnownModel = HAIKU;
    const b: KnownModel = SONNET;
    expect([a, b]).toEqual([SPARK, SPARK]);
  });
});
