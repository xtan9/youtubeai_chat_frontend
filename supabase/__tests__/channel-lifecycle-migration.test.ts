import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../migrations/20260901000000_channel_lifecycle_compliance.sql",
);

function migration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("Channel lifecycle compliance database contract", () => {
  it("stores lifecycle state and bounds identifying Channel data to 30 days", () => {
    const sql = migration();

    expect(sql).toMatch(/create table channel_private\.channel_lifecycles/i);
    expect(sql).toMatch(/read_only_grace/i);
    expect(sql).toMatch(/grace_started_at/i);
    expect(sql).toMatch(/grace_ends_at/i);
    expect(sql).toMatch(/channel_private\.retention_records/i);
    expect(sql).toMatch(/review_text/i);
    expect(sql).toMatch(/youtube_api_data/i);
    expect(sql).toMatch(/draft_text/i);
    expect(sql).toMatch(/audit_provenance/i);
    expect(sql).toMatch(/interval '30 days'/i);
    expect(sql).toMatch(/aggregate/i);
    expect(sql).toMatch(/deletion_status/i);
    expect(sql).toMatch(/record_channel_retention_deletion/i);
    expect(sql).toMatch(/source_table/i);
    expect(sql).not.toMatch(/access_token|refresh_token/i);
  });

  it("offers reply deletion before removing grant/provenance and gives YouTube guidance afterward", () => {
    const sql = migration();

    expect(sql).toMatch(/channel_private\.reply_controls/i);
    expect(sql).toMatch(/last_refreshed_at/i);
    expect(sql).toMatch(/last_refreshed_at\s*>\s*p_now\s*-\s*interval\s*'30 days'/i);
    expect(sql).toMatch(/instructions_required/i);
    expect(sql).toMatch(/provider_reply_id/i);
    expect(sql).toMatch(/delete_before_revocation/i);
    expect(sql).toMatch(/myaccount\.google\.com\/permissions/i);
    expect(sql).toMatch(/provenance_removed/i);
    expect(sql).toMatch(/reply_deletion/i);
    expect(sql).toMatch(/expire_channel_reply_controls/i);
  });

  it("creates retryable monitored cleanup work with a seven-day deadline", () => {
    const sql = migration();

    expect(sql).toMatch(/channel_private\.cleanup_work/i);
    expect(sql).toMatch(/channel_private\.cleanup_attempts/i);
    expect(sql).toMatch(/next_attempt_at/i);
    expect(sql).toMatch(/deadline_at/i);
    expect(sql).toMatch(/attempt_count/i);
    expect(sql).toMatch(/skip locked/i);
    expect(sql).toMatch(/worker_lease_expires_at\s*<=\s*p_now/i);
    expect(sql).toMatch(/reply_deletion_decision\s*<>\s*'pending'/i);
    expect(sql).toMatch(/choose_channel_cleanup_reply/i);
    expect(sql).toMatch(/timed_out/i);
    expect(sql).toMatch(/escalat/i);
    expect(sql).toMatch(/interval '7 days'/i);
    expect(sql).toMatch(/service_role/i);
  });

  it("starts grace on a paid-to-free transition and does not report cleanup before both outcomes are known", () => {
    const sql = migration();

    expect(sql).toMatch(/user_subscriptions/i);
    expect(sql).toMatch(/old\.tier\s*=\s*'pro'/i);
    expect(sql).toMatch(/new\.tier\s*<>\s*'pro'/i);
    expect(sql).toMatch(/enforce_channel_paid_work_lifecycle/i);
    expect(sql).toMatch(/enforce_channel_reply_deletion_lifecycle/i);
    expect(sql).toMatch(/enforce_channel_scan_lifecycle/i);
    expect(sql).toMatch(/draft_requested/i);
    expect(sql).toMatch(/publishing/i);
    expect(sql).toMatch(/subscription\.tier\s*=\s*'pro'/i);
    expect(sql).toMatch(/channel_cleanup_work/i);
    expect(sql).toMatch(/local_deletion_status/i);
    expect(sql).toMatch(/grant_revocation_status/i);
    expect(sql).toMatch(/status\s*=\s*'completed'[\s\S]*local_deletion_status/i);
    expect(sql).toMatch(/grant_revocation_failed|revocation_failed/i);
    expect(sql).toMatch(/already_absent/i);
    expect(sql).toMatch(/update public\.channel_oauth_grants/i);
    expect(sql).toMatch(/update channel_private\.channel_lifecycles/i);
    expect(sql).toMatch(/delete_channel_local_data/i);
    expect(sql).toMatch(/prepare_channel_account_deletion/i);
    expect(sql).toMatch(/channel_cleanup_before_account_delete/i);
    expect(sql).toMatch(/before delete on auth\.users/i);
    expect(sql).toMatch(/channel_scan_assessments/i);
    expect(sql).toMatch(/channel_scan_run_pages/i);
    expect(sql).toMatch(/interaction_assessments/i);
  });
});
