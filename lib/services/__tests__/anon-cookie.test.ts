// lib/services/__tests__/anon-cookie.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { signAnonId, verifyAnonId, ANON_COOKIE_NAME } from "../anon-cookie";

const SECRET = "test-secret-32-chars-minimum-aaaa";

describe("anon-cookie sign/verify", () => {
  beforeEach(() => {
    vi.stubEnv("ANON_COOKIE_SECRET", SECRET);
  });

  it("round-trips a UUID", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const signed = signAnonId(id);
    expect(verifyAnonId(signed!)).toBe(id);
  });

  it("rejects a tampered payload", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const signed = signAnonId(id);
    const tampered = signed!.replace(id, "22222222-2222-2222-2222-222222222222");
    expect(verifyAnonId(tampered)).toBeNull();
  });

  it("rejects a malformed cookie", () => {
    expect(verifyAnonId("not-a-cookie")).toBeNull();
    expect(verifyAnonId("")).toBeNull();
    expect(verifyAnonId("abc.def")).toBeNull();
  });

  it("returns null when ANON_COOKIE_SECRET missing", () => {
    vi.stubEnv("ANON_COOKIE_SECRET", "");
    const id = "11111111-1111-1111-1111-111111111111";
    expect(signAnonId(id)).toBeNull();
    expect(verifyAnonId("anything")).toBeNull();
  });

  it("exports the cookie name", () => {
    expect(ANON_COOKIE_NAME).toBe("yt_anon_id");
  });
});
