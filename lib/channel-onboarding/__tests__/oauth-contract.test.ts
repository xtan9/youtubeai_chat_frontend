import { describe, expect, it } from "vitest";

import {
  YOUTUBE_CHANNEL_OAUTH_CONTRACT,
  YOUTUBE_CHANNEL_OAUTH_SCOPES,
  isValidYouTubeReadAuthorization,
  toYouTubeReadAuthorization,
  validateYouTubeOAuthCallback,
} from "@/lib/channel-oauth";
import {
  CURRENT_YOUTUBE_CHANNEL_OAUTH_VERIFICATION,
  YouTubeChannelOAuthVerificationSchema,
  evaluateYouTubeChannelOAuthVerificationGate,
} from "@/lib/compliance/youtube-channel-oauth-verification";

const READ_CALLBACK = {
  intent: "read_identity" as const,
  expectedState: "state-for-researcher-1",
  returnedState: "state-for-researcher-1",
  authenticatedAccountId: "researcher-1",
  grantedScopes: [YOUTUBE_CHANNEL_OAUTH_SCOPES.readIdentity],
  explicitConsent: true,
};

describe("Supported Creator Channel OAuth contract", () => {
  it("publishes one exact incremental Google contract without credentials", () => {
    expect(YOUTUBE_CHANNEL_OAUTH_CONTRACT).toMatchObject({
      provider: "google",
      applicationName: "YouTubeAI",
      productSurface: "Channel Hub",
      authorizedDomains: ["youtubeai.chat"],
      redirectUris: [
        "https://youtubeai.chat/api/channel/oauth/callback",
      ],
      requestedScopes: {
        readIdentity: [YOUTUBE_CHANNEL_OAUTH_SCOPES.readIdentity],
        writeReply: [YOUTUBE_CHANNEL_OAUTH_SCOPES.writeReply],
      },
    });
    expect(YOUTUBE_CHANNEL_OAUTH_CONTRACT).not.toHaveProperty("clientId");
    expect(YOUTUBE_CHANNEL_OAUTH_CONTRACT).not.toHaveProperty("clientSecret");
  });

  it("accepts a read callback only when state, account, consent, and scope are valid", () => {
    const result = validateYouTubeOAuthCallback(READ_CALLBACK);

    expect(result).toEqual({
      kind: "accepted",
      authorization: {
        provider: "youtube",
        intent: "read_identity",
        accountId: "researcher-1",
        grantedScopes: [YOUTUBE_CHANNEL_OAUTH_SCOPES.readIdentity],
        stateValidated: true,
        explicitConsent: true,
      },
    });
  });

  it("rejects missing or mismatched callback state and account identity", () => {
    expect(
      validateYouTubeOAuthCallback({
        ...READ_CALLBACK,
        expectedState: "",
      }),
    ).toEqual({ kind: "blocked", reason: "callback_state_unavailable" });
    expect(
      validateYouTubeOAuthCallback({
        ...READ_CALLBACK,
        returnedState: "another-state",
      }),
    ).toEqual({ kind: "blocked", reason: "callback_state_mismatch" });
    expect(
      validateYouTubeOAuthCallback({
        ...READ_CALLBACK,
        authenticatedAccountId: null,
      }),
    ).toEqual({ kind: "blocked", reason: "authenticated_account_required" });
  });

  it("rejects non-minimal read scopes and missing explicit consent", () => {
    expect(
      validateYouTubeOAuthCallback({
        ...READ_CALLBACK,
        grantedScopes: [
          YOUTUBE_CHANNEL_OAUTH_SCOPES.readIdentity,
          "openid",
        ],
      }),
    ).toEqual({ kind: "blocked", reason: "unexpected_scope" });
    expect(
      validateYouTubeOAuthCallback({
        ...READ_CALLBACK,
        explicitConsent: false,
      }),
    ).toEqual({ kind: "blocked", reason: "explicit_consent_required" });
  });

  it("rejects malformed callback envelopes instead of accepting code or token fields", () => {
    expect(validateYouTubeOAuthCallback(null)).toEqual({
      kind: "blocked",
      reason: "invalid_callback_payload",
    });
    expect(
      validateYouTubeOAuthCallback({
        ...READ_CALLBACK,
        code: "authorization-code-must-not-enter-the-contract",
      }),
    ).toEqual({ kind: "blocked", reason: "invalid_callback_payload" });
  });

  it("requires force-ssl for a later write authorization and accepts only a cumulative read scope", () => {
    expect(
      validateYouTubeOAuthCallback({
        ...READ_CALLBACK,
        intent: "write_reply",
        grantedScopes: [YOUTUBE_CHANNEL_OAUTH_SCOPES.readIdentity],
      }),
    ).toEqual({ kind: "blocked", reason: "required_scope_missing" });

    expect(
      validateYouTubeOAuthCallback({
        ...READ_CALLBACK,
        intent: "write_reply",
        grantedScopes: [
          YOUTUBE_CHANNEL_OAUTH_SCOPES.readIdentity,
          YOUTUBE_CHANNEL_OAUTH_SCOPES.writeReply,
        ],
      }),
    ).toMatchObject({
      kind: "accepted",
      authorization: {
        intent: "write_reply",
        grantedScopes: [
          YOUTUBE_CHANNEL_OAUTH_SCOPES.readIdentity,
          YOUTUBE_CHANNEL_OAUTH_SCOPES.writeReply,
        ],
      },
    });

    expect(
      validateYouTubeOAuthCallback({
        ...READ_CALLBACK,
        intent: "write_reply",
        grantedScopes: [
          YOUTUBE_CHANNEL_OAUTH_SCOPES.writeReply,
          "https://www.googleapis.com/auth/youtube.upload",
        ],
      }),
    ).toEqual({ kind: "blocked", reason: "unexpected_scope" });
  });

  it("turns an accepted read callback into a strict persisted onboarding authorization", () => {
    const result = validateYouTubeOAuthCallback(READ_CALLBACK);
    if (result.kind !== "accepted") throw new Error("expected accepted callback");

    const authorization = toYouTubeReadAuthorization(result.authorization);
    expect(authorization).toMatchObject({
      status: "completed",
      readScopeGranted: true,
      accountId: "researcher-1",
    });
    expect(
      isValidYouTubeReadAuthorization(authorization, "researcher-1"),
    ).toBe(true);
    expect(
      isValidYouTubeReadAuthorization(
        {
          ...authorization,
          accountId: "another-researcher",
        },
        "researcher-1",
      ),
    ).toBe(false);
    expect(
      isValidYouTubeReadAuthorization(
        {
          ...authorization,
          grantedScopes: [YOUTUBE_CHANNEL_OAUTH_SCOPES.writeReply],
        },
        "researcher-1",
      ),
    ).toBe(false);
    expect(
      toYouTubeReadAuthorization({
        ...result.authorization,
        stateValidated: false,
      }),
    ).toBeNull();
  });

  it("keeps the checked-in Google verification record blocked until human evidence exists", () => {
    expect(CURRENT_YOUTUBE_CHANNEL_OAUTH_VERIFICATION.status).toBe(
      "pending_external_verification",
    );
    expect(
      evaluateYouTubeChannelOAuthVerificationGate(
        CURRENT_YOUTUBE_CHANNEL_OAUTH_VERIFICATION,
      ),
    ).toMatchObject({ status: "blocked" });
  });

  it("opens only a verified record whose evidence and contract match", () => {
    const verified = {
      ...CURRENT_YOUTUBE_CHANNEL_OAUTH_VERIFICATION,
      status: "verified" as const,
      verificationEvidence: {
        sourceReference: "https://console.cloud.google.com/test-verification",
        verifiedAt: "2026-09-01",
        verifiedBy: "Google verification authority (test fixture)",
      },
    };

    expect(YouTubeChannelOAuthVerificationSchema.safeParse(verified).success).toBe(
      true,
    );
    expect(evaluateYouTubeChannelOAuthVerificationGate(verified)).toMatchObject({
      status: "open",
    });
    expect(
      evaluateYouTubeChannelOAuthVerificationGate({
        ...verified,
        contract: {
          ...verified.contract,
          redirectUris: ["https://attacker.example/callback"],
        },
      }),
    ).toMatchObject({ status: "blocked" });
  });
});
