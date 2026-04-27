import { describe, it, expect } from "vitest";
import { buildRecoveryRedirectUrl } from "../recovery-redirect";

describe("buildRecoveryRedirectUrl", () => {
  // Two invariants these tests pin:
  //
  // (a) The URL must live under the apex origin (no `www.`). The Supabase
  //     allowlist for this project only wildcards the apex, so any www-based
  //     URL is silently rejected and Supabase falls back to the Site URL,
  //     dropping recovery clickers on "/" instead of the update-password
  //     form.
  //
  // (b) The path must be /auth/update-password, NOT /auth/callback. This
  //     project's recovery email goes through Supabase's legacy verify
  //     endpoint (implicit grant — verified empirically: 13 recovery
  //     flow_state rows, 0 with auth_code_issued_at set), which lands users
  //     with #access_token=... in a fragment. /auth/callback only handles
  //     ?code= and would 307 to /auth/auth-code-error (a 404). Pointing at
  //     /auth/update-password lets the browser supabase client pick up the
  //     fragment on page mount and surface the form.
  it("strips www. so the URL matches the allowlisted apex origin", () => {
    expect(buildRecoveryRedirectUrl("https://www.youtubeai.chat")).toBe(
      "https://youtubeai.chat/auth/update-password"
    );
  });

  it("preserves apex origin unchanged", () => {
    expect(buildRecoveryRedirectUrl("https://youtubeai.chat")).toBe(
      "https://youtubeai.chat/auth/update-password"
    );
  });

  it("preserves localhost (no www to strip)", () => {
    expect(buildRecoveryRedirectUrl("http://localhost:3000")).toBe(
      "http://localhost:3000/auth/update-password"
    );
  });

  it("strips www. case-insensitively (browser origin is lowercased but be defensive)", () => {
    expect(buildRecoveryRedirectUrl("https://WWW.youtubeai.chat")).toBe(
      "https://youtubeai.chat/auth/update-password"
    );
  });

  it("does not strip subdomains that merely start with 'www'", () => {
    // wwwx.example.com is not the www subdomain — guarding against a
    // greedy regex that would strip "www" from anywhere in the host.
    expect(buildRecoveryRedirectUrl("https://wwwx.example.com")).toBe(
      "https://wwwx.example.com/auth/update-password"
    );
  });

  it("targets /auth/update-password directly (regression: the implicit-grant flow used here doesn't carry ?code=)", () => {
    // PR #44 routed through /auth/callback?next=/auth/update-password
    // assuming PKCE recovery. That assumption was wrong: this project's
    // recovery emails come back with a hash fragment, not a code, so the
    // callback handler 307'd users to the 404 /auth/auth-code-error page.
    const url = buildRecoveryRedirectUrl("https://youtubeai.chat");
    expect(new URL(url).pathname).toBe("/auth/update-password");
    expect(url).not.toContain("/auth/callback");
    expect(new URL(url).search).toBe("");
  });
});
