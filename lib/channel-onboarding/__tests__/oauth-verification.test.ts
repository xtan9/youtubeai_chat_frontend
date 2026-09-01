import { describe, expect, it } from "vitest";

import {
  CURRENT_YOUTUBE_OAUTH_VERIFICATION,
  evaluateYouTubeOAuthVerificationGate,
} from "../oauth-verification";
import {
  YOUTUBE_FORCE_SSL_SCOPE,
  YOUTUBE_READONLY_SCOPE,
} from "../scopes";

const VERIFIED = {
  recordType: "youtube-channel-oauth-verification" as const,
  recordVersion: 1 as const,
  provider: "youtube" as const,
  status: "verified" as const,
  verificationReference: "evidence://oauth-review",
  verifiedAt: "2026-09-01T12:00:00.000Z",
  verifiedBy: "external reviewer",
  approvedScopes: [YOUTUBE_READONLY_SCOPE, YOUTUBE_FORCE_SSL_SCOPE],
};

describe("YouTube OAuth verification gate", () => {
  it("keeps the checked-in external verification record closed", () => {
    expect(CURRENT_YOUTUBE_OAUTH_VERIFICATION).toMatchObject({
      status: "pending_external_verification",
    });
    expect(
      evaluateYouTubeOAuthVerificationGate(
        CURRENT_YOUTUBE_OAUTH_VERIFICATION,
      ),
    ).toMatchObject({
      status: "blocked",
      reason: "pending_external_verification",
    });
  });

  it("opens only for externally evidenced requested scopes", () => {
    expect(
      evaluateYouTubeOAuthVerificationGate(VERIFIED, [YOUTUBE_READONLY_SCOPE]),
    ).toMatchObject({ status: "open" });
    expect(
      evaluateYouTubeOAuthVerificationGate(VERIFIED, [
        "https://www.googleapis.com/auth/youtube.upload",
      ]),
    ).toMatchObject({
      status: "blocked",
      reason: "required_scope_not_verified",
    });
    expect(
      evaluateYouTubeOAuthVerificationGate(VERIFIED, []),
    ).toMatchObject({
      status: "blocked",
      reason: "required_scope_not_verified",
    });
  });
});
