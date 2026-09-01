import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../migrations/20260901020000_channel_real_public_reply_foundation.sql",
);

function migration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("real Public Reply foundation database contract", () => {
  it("records a provider-specific attempt without retaining reply text or credentials", () => {
    const sql = migration();

    expect(sql).toMatch(/channel_private\.public_reply_publication_attempts/i);
    expect(sql).toMatch(/publication_provider text/i);
    expect(sql).toMatch(/provider_reply_id text/i);
    expect(sql).toMatch(/quota_cost integer not null default 50/i);
    expect(sql).toMatch(/comments\.insert/i);
    expect(sql).not.toMatch(/access_token|refresh_token|client_secret/i);
    expect(sql).not.toMatch(/published_text text/i);
  });

  it("makes the publication claim explicit, atomic, and uniformly quota limited", () => {
    const sql = migration();

    expect(sql).toMatch(/drop function if exists public\.channel_work_item_claim_publication/i);
    expect(sql).toMatch(/p_explicit_confirmation boolean/i);
    expect(sql).toMatch(/explicit_confirmation_required/i);
    expect(sql).toMatch(/channel_public_reply_daily_usage/i);
    expect(sql).toMatch(/publication_count integer not null default 0/i);
    expect(sql).toMatch(/publication_count >= 10/i);
    expect(sql).toMatch(/quota_units[\s\S]*50|50[\s\S]*quota_units/);
    expect(sql).toMatch(/for update/i);
  });

  it("links published and deleted real controls to lifecycle retention without opening transport", () => {
    const sql = migration();

    expect(sql).toMatch(/channel_private\.reply_controls/i);
    expect(sql).toMatch(/channel_real_reply_control_sync/i);
    expect(sql).toMatch(/channel_real_reply_deletion_provenance/i);
    expect(sql).toMatch(/state in \('active', 'read_only_grace'\)/i);
    expect(sql).toMatch(/interval '30 days'/i);
    expect(sql).toMatch(/last_refreshed_at/i);
    expect(sql).toMatch(/status = 'deleted'/i);
    expect(sql).toMatch(/revoke all on function public\.channel_work_item_claim_publication/i);
    expect(sql).not.toMatch(/https?:\/\//i);
    expect(sql).not.toMatch(/\bfetch\s*\(/i);
  });
});
