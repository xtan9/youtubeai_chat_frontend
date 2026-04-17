import { describe, it, expect } from "vitest";
import { computeUrlHash } from "../summarize-cache";

describe("computeUrlHash", () => {
  it("returns consistent hash for the same URL", () => {
    const hash1 = computeUrlHash("https://www.youtube.com/watch?v=abc123");
    const hash2 = computeUrlHash("https://www.youtube.com/watch?v=abc123");
    expect(hash1).toBe(hash2);
  });

  it("returns different hashes for different URLs", () => {
    const hash1 = computeUrlHash("https://www.youtube.com/watch?v=abc123");
    const hash2 = computeUrlHash("https://www.youtube.com/watch?v=xyz789");
    expect(hash1).not.toBe(hash2);
  });

  it("returns a hex string", () => {
    const hash = computeUrlHash("https://www.youtube.com/watch?v=test");
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });
});
