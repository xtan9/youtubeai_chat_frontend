import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../migrations/20260831010000_channel_public_reply_lifecycle.sql",
);

function migration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("Public Reply lifecycle database contract", () => {
  it("persists provider identity, observed text, uncertainty, and deletion state", () => {
    const sql = migration();

    expect(sql).toMatch(/alter table public\.channel_work_items/i);
    expect(sql).toMatch(/provider_reply_id text/i);
    expect(sql).toMatch(/last_observed_text text/i);
    expect(sql).toMatch(/externally_edited boolean/i);
    expect(sql).toMatch(/lifecycle_revision bigint/i);
    expect(sql).toMatch(/deletion_status text/i);
    expect(sql).toMatch(/publication_uncertain/i);
    expect(sql).toMatch(/deletion_status in \(/i);
  });

  it("keeps ambiguous publication non-retryable and grants retry only to explicit safe outcomes", () => {
    const sql = migration();

    expect(sql).toMatch(
      /channel_work_item_record_publication_completion[\s\S]*p_outcome text/i,
    );
    expect(sql).toMatch(
      /p_outcome = 'ambiguous'[\s\S]*status = 'publication_uncertain'[\s\S]*retryAllowed', false/i,
    );
    expect(sql).toMatch(
      /channel_work_item_reconcile_publication[\s\S]*verified_presence[\s\S]*verified_absence[\s\S]*continued_uncertainty/i,
    );
    expect(sql).toMatch(
      /status = 'draft_ready'[\s\S]*retry_authorized_by = 'verified_absence'/i,
    );
    expect(sql).toMatch(
      /channel_work_item_can_retry_publication[\s\S]*status <> 'publication_uncertain'/i,
    );
    expect(sql).toMatch(/p_current_comment_hash text/i);
    expect(sql).toMatch(/p_final_text_validated boolean/i);
    expect(sql).toMatch(/p_remaining_daily_publications integer/i);
    expect(sql).toMatch(/active_connected_channel_selections[\s\S]*write_scope_granted is true/i);
  });

  it("requires explicit deletion confirmation and reports completion only after the local terminal update", () => {
    const sql = migration();

    expect(sql).toMatch(
      /channel_work_item_prepare_reply_deletion[\s\S]*p_confirmation boolean/i,
    );
    expect(sql).toMatch(
      /p_confirmation is not true[\s\S]*confirmation_required[\s\S]*completionReported', false/i,
    );
    expect(sql).toMatch(
      /channel_work_item_complete_reply_deletion[\s\S]*p_provider_outcome text/i,
    );
    expect(sql).toMatch(
      /status = 'deleted'[\s\S]*deletion_status = 'completed'[\s\S]*completionReported', true/i,
    );
    expect(sql).toMatch(/No publication allowance or publication counter/i);
    expect(sql).toMatch(/never[\s\S]*without[\s\S]*explicit[\s\S]*confirmation/i);
  });
});
