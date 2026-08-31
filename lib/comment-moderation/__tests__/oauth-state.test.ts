import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  createYouTubeOAuthState,
  verifyYouTubeOAuthState,
} from "../oauth-state";

describe("YouTube OAuth state", () => {
  beforeEach(() => {
    vi.stubEnv(
      "YOUTUBE_OAUTH_STATE_SECRET",
      "test-only-state-secret-that-is-longer-than-thirty-two-characters",
    );
  });

  afterEach(() => vi.unstubAllEnvs());

  it("binds the callback to the current user", () => {
    const state = createYouTubeOAuthState("user-a", 1_000);
    expect(verifyYouTubeOAuthState(state, "user-a", 2_000)).toBe(true);
    expect(verifyYouTubeOAuthState(state, "user-b", 2_000)).toBe(false);
  });

  it("expires after ten minutes", () => {
    const state = createYouTubeOAuthState("user-a", 1_000);
    expect(verifyYouTubeOAuthState(state, "user-a", 601_001)).toBe(false);
  });

  it("rejects a modified signature", () => {
    const state = createYouTubeOAuthState("user-a", 1_000);
    expect(verifyYouTubeOAuthState(`${state}x`, "user-a", 2_000)).toBe(false);
  });
});
