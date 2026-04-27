import { describe, it, expect } from "vitest";
import { buildRecoveryRedirectUrl } from "../recovery-redirect";

describe("buildRecoveryRedirectUrl", () => {
  // Why these specific assertions: Supabase silently rejects redirectTo
  // values not present in the project's Auth allowlist and falls back to
  // the configured Site URL, which sends recovery-link clickers to "/"
  // instead of the update-password form. The allowlist for this project
  // covers https://youtubeai.chat/** (apex, wildcard) but only an exact
  // match for https://www.youtubeai.chat/auth/callback (no query). The
  // canonical recovery destination must therefore live under the apex
  // origin, with /auth/callback?next=/auth/update-password as the path.
  it("strips www. so the URL matches the allowlisted apex origin", () => {
    expect(buildRecoveryRedirectUrl("https://www.youtubeai.chat")).toBe(
      "https://youtubeai.chat/auth/callback?next=/auth/update-password"
    );
  });

  it("preserves apex origin unchanged", () => {
    expect(buildRecoveryRedirectUrl("https://youtubeai.chat")).toBe(
      "https://youtubeai.chat/auth/callback?next=/auth/update-password"
    );
  });

  it("preserves localhost (no www to strip)", () => {
    expect(buildRecoveryRedirectUrl("http://localhost:3000")).toBe(
      "http://localhost:3000/auth/callback?next=/auth/update-password"
    );
  });

  it("strips www. case-insensitively (browser origin is lowercased but be defensive)", () => {
    expect(buildRecoveryRedirectUrl("https://WWW.youtubeai.chat")).toBe(
      "https://youtubeai.chat/auth/callback?next=/auth/update-password"
    );
  });

  it("does not strip subdomains that merely start with 'www'", () => {
    // wwwx.example.com is not the www subdomain — guarding against a
    // greedy regex that would strip "www" from anywhere in the host.
    expect(buildRecoveryRedirectUrl("https://wwwx.example.com")).toBe(
      "https://wwwx.example.com/auth/callback?next=/auth/update-password"
    );
  });

  it("routes through /auth/callback so the PKCE code can be exchanged server-side", () => {
    // Regression guard: the previous implementation pointed redirectTo at
    // /auth/update-password directly. The page is client-only and never
    // exchanges the ?code= the verify endpoint appends, so users hitting
    // the URL would be unable to set a new password even when the
    // allowlist accepted them. Routing through /auth/callback keeps the
    // exchange in the existing PKCE handler.
    const url = buildRecoveryRedirectUrl("https://youtubeai.chat");
    expect(url).toContain("/auth/callback?next=/auth/update-password");
    // Path component of the URL must be /auth/callback, not /auth/update-password.
    expect(new URL(url).pathname).toBe("/auth/callback");
  });
});
