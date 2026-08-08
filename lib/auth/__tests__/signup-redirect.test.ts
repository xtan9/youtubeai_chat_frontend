import { describe, expect, it } from "vitest";
import {
  buildAuthCallbackUrl,
  getSafeAuthRedirect,
  normalizeAuthRedirect,
} from "../signup-redirect";

describe("normalizeAuthRedirect", () => {
  it("preserves an internal path and query string", () => {
    expect(normalizeAuthRedirect("/pricing?intent=upgrade")).toBe(
      "/pricing?intent=upgrade",
    );
  });

  it("defaults when the redirect is external", () => {
    expect(normalizeAuthRedirect("https://evil.example.com")).toBe(
      "/dashboard",
    );
  });

  it("defaults when the redirect is protocol-relative", () => {
    expect(normalizeAuthRedirect("//evil.example.com/account")).toBe(
      "/dashboard",
    );
  });
});

describe("getSafeAuthRedirect", () => {
  it("reads the encoded redirect_to value from the current signup URL", () => {
    expect(
      getSafeAuthRedirect(
        "https://www.youtubeai.chat/auth/sign-up?redirect_to=%2Fpricing%3Fintent%3Dupgrade",
      ),
    ).toBe("/pricing?intent=upgrade");
  });

  it("defaults when redirect_to is absent", () => {
    expect(
      getSafeAuthRedirect("https://www.youtubeai.chat/auth/sign-up"),
    ).toBe("/dashboard");
  });

  it("rejects an external redirect_to value from the signup URL", () => {
    expect(
      getSafeAuthRedirect(
        "https://www.youtubeai.chat/auth/sign-up?redirect_to=https%3A%2F%2Fevil.example.com",
      ),
    ).toBe("/dashboard");
  });

  it("rejects a protocol-relative redirect_to value from the signup URL", () => {
    expect(
      getSafeAuthRedirect(
        "https://www.youtubeai.chat/auth/sign-up?redirect_to=%2F%2Fevil.example.com%2Faccount",
      ),
    ).toBe("/dashboard");
  });
});

describe("buildAuthCallbackUrl", () => {
  it("encodes the safe destination as the callback next parameter", () => {
    const url = new URL(
      buildAuthCallbackUrl(
        "https://www.youtubeai.chat",
        "/pricing?intent=upgrade",
      ),
    );

    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("next")).toBe("/pricing?intent=upgrade");
  });
});
