import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../migrations/20260901010000_channel_oauth_credential_boundary.sql",
);

function migration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("Supported Creator Channel OAuth database boundary", () => {
  it("stores only an opaque credential reference and explicit scope inventory", () => {
    const sql = migration();

    expect(sql).toMatch(/add column if not exists oauth_scopes text\[\]/i);
    expect(sql).toMatch(/add column if not exists credential_reference_id text/i);
    expect(sql).toMatch(/channel_oauth_grants_scopes_ck/i);
    expect(sql).toMatch(/youtube\.readonly/i);
    expect(sql).toMatch(/youtube\.force-ssl/i);
    expect(sql).not.toMatch(/\b(?:access_token|refresh_token|oauth_token)\b/iu);
  });

  it("keeps credential-bound onboarding service-role-only and read-only", () => {
    const sql = migration();

    expect(sql).toMatch(
      /complete_channel_onboarding_with_credential[\s\S]*p_channel_id uuid[\s\S]*p_grant_id uuid[\s\S]*p_connected_channel_id uuid[\s\S]*p_credential_reference_id text/i,
    );
    expect(sql).toMatch(/write_scope_granted\s*,\s*\n\s*status/i);
    expect(sql).toMatch(/true,\s*\n\s*false,\s*\n\s*'active'/i);
    expect(sql).toMatch(
      /revoke all on function public\.complete_channel_onboarding\([\s\S]*service_role/i,
    );
    expect(sql).toMatch(/revoke all on function public\.complete_channel_onboarding_with_credential/i);
    expect(sql).toMatch(
      /grant execute on function public\.complete_channel_onboarding_with_credential[\s\S]*uuid, boolean, uuid, uuid, uuid, text, text, text, text[\s\S]*to service_role/i,
    );
  });
});
