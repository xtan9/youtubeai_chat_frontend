import { describe, expect, it } from "vitest";

import { GET as oauthCallback } from "@/app/api/channel/oauth/callback/route";
import { POST as oauthStart } from "@/app/api/channel/oauth/start/route";

describe("Supported Creator Channel OAuth routes", () => {
  it("keeps OAuth initiation blocked while Google verification is pending", async () => {
    const response = await oauthStart();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      outcome: "blocked",
      reason: "oauth_verification_required",
      message:
        "Google OAuth verification is pending; the Supported Creator Channel OAuth flow remains disabled.",
    });
  });

  it("does not exchange, persist, or echo an OAuth callback code while the gate is closed", async () => {
    const secretCode = "authorization-code-must-not-appear";
    const response = await oauthCallback(
      new Request(
        `https://youtubeai.chat/api/channel/oauth/callback?code=${secretCode}&state=untrusted`,
      ),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).not.toContain(secretCode);
    expect(body).toContain("oauth_verification_required");
  });
});
