import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: vi.fn(),
}));
vi.mock("@/lib/channel-exposure/server", () => ({
  loadChannelAccessSnapshot: vi.fn(),
  loadOwnedVideoForUrl: vi.fn(),
}));
vi.mock("@/lib/services/entitlements", () => ({
  resolveRegisteredSubscription: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST as channelAction } from "../actions/route";
import { POST as accountAction } from "../account/route";
import { GET as ownedVideo } from "../owned-video/route";
import { GET as oauthCallback } from "../oauth/callback/route";
import { GET as oauthStart, POST as oauthStartPost } from "../oauth/start/route";

describe("Channel production release boundaries", () => {
  it.each([
    ["Hub action", () => channelAction(new Request("https://youtubeai.chat/api/channel/actions", { method: "POST", body: "{}" }))],
    ["Account control", () => accountAction(new Request("https://youtubeai.chat/api/channel/account", { method: "POST", body: JSON.stringify({ action: "revoke" }) }))],
    ["Owned Video lookup", () => ownedVideo(new Request("https://youtubeai.chat/api/channel/owned-video?url=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ"))],
    ["OAuth start", () => oauthStart()],
    ["OAuth start POST", () => oauthStartPost()],
  ])("keeps %s blocked by the incomplete launch packet", async (_name, invoke) => {
    const response = await invoke();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      outcome: "blocked",
      reason: "channel_release_required",
    });
  });

  it("does not read, echo, or exchange a callback code while release is blocked", async () => {
    const secretCode = "authorization-code-must-not-appear";
    const response = await oauthCallback(
      new Request(
        `https://youtubeai.chat/api/channel/oauth/callback?code=${secretCode}&state=untrusted`,
      ),
    );

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(secretCode);
  });
});
