import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../migrations/20260901015000_youtube_channel_scan_foundation.sql",
);

function migration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("real YouTube Channel Scan database foundation", () => {
  it("keeps provider selection, quotas, and credential storage bounded", () => {
    const sql = migration();

    expect(sql).toMatch(/provider in \('synthetic', 'youtube'\)/i);
    expect(sql).toMatch(/read_scope_granted is true/i);
    expect(sql).toMatch(/created_at >= now\(\) - interval '1 hour'/i);
    expect(sql).toMatch(/p_provider not in \('synthetic', 'youtube'\)/i);
    expect(sql).toMatch(/video_id text/i);
    expect(sql).toMatch(/p_video_id text/i);
    expect(sql).toContain(
      "check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{11}$');",
    );
    expect(sql).not.toMatch(/access_token|refresh_token|oauth_token/i);
  });

  it("binds real completions, current-hash reuse, deletion redaction, and retention cleanup", () => {
    const sql = migration();

    expect(sql).toMatch(/interaction_assessment_id uuid/i);
    expect(sql).not.toMatch(
      /interaction_assessment_id uuid[\s\S]{0,120}on delete set null/i,
    );
    expect(sql).toMatch(/p_current_content_hash text default null/i);
    expect(sql).toMatch(/content_hash = current_content_hash/i);
    expect(sql).toMatch(/assessment\.video_id = item_video_id/i);
    expect(sql).toMatch(/assessment_id is not null\) <> \(interaction_assessment_id is not null\)/i);
    expect(sql).toMatch(/create function public\.find_reusable_interaction_assessment/i);
    expect(sql).toMatch(/comment_text_hash = p_comment_text_hash/i);
    expect(sql).toMatch(/cleanup_expired_interaction_assessments/i);
    expect(sql).toMatch(/not exists \(\s*select 1\s*from public\.channel_scan_run_threads/i);
    expect(sql).toMatch(/cleanup_expired_channel_scan_runs/i);
    expect(sql).toMatch(/interval '30 days'/i);
  });

  it("resolves only one account-owned active Supported Creator identity", () => {
    const sql = migration();

    expect(sql).toMatch(/create function public\.resolve_channel_scan_target/i);
    expect(sql).toMatch(/active\.connected_channel_id::text = btrim\(p_connected_channel_id\)/i);
    expect(sql).toMatch(/connected\.supported_creator is true/i);
    expect(sql).toMatch(/grant_record\.status = 'active'/i);
    expect(sql).toMatch(/channel_adult_attestations/i);
    expect(sql).toMatch(/limit 1/i);
    expect(sql).toMatch(/grant execute on function public\.resolve_channel_scan_target[\s\S]*to service_role/i);
  });
});
