import { describe, it, expect } from "vitest";
import { HAIKU, SONNET, type KnownModel } from "../models";

describe("models constants", () => {
  it("HAIKU includes the dated suffix (gateway requirement)", () => {
    // Per models.ts comment: undated `claude-haiku-4-5` returns 502 from
    // CLIProxyAPI ('unknown provider'). Dated form must be preserved.
    expect(HAIKU).toMatch(/^claude-haiku-4-5-\d{8}$/);
  });

  it("SONNET resolves through gateway aliasing (no dated suffix required)", () => {
    // Per models.ts comment: SONNET works undated because its alias is
    // wired through. The exact value is the contract; pin it.
    expect(SONNET).toBe("claude-sonnet-4-6");
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
