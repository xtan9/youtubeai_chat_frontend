import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../migrations/20260831000000_channel_onboarding_foundation.sql",
);

function migration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("Channel onboarding database foundation", () => {
  it("keeps the Channel resource, grant, and provider identity as distinct owner-keyed records", () => {
    const sql = migration();

    expect(sql).toMatch(/create table public\.channels/i);
    expect(sql).toMatch(/create table public\.channel_oauth_grants/i);
    expect(sql).toMatch(/create table public\.connected_youtube_channels/i);
    expect(sql).toMatch(/channel_oauth_grants_channel_owner_fk/i);
    expect(sql).toMatch(/connected_youtube_channels_grant_owner_fk/i);
    expect(sql).toMatch(/unique \(oauth_grant_id\)/i);
    expect(sql).toMatch(/supported_creator boolean[^\n]*default true/i);
    expect(sql).not.toMatch(/access_token|refresh_token|oauth_token/i);
  });

  it("makes onboarding a trusted, paid, attested atomic commit", () => {
    const sql = migration();

    expect(sql).toMatch(/create or replace function public\.complete_channel_onboarding/i);
    expect(sql).toMatch(/p_provider_identity_verified boolean/i);
    expect(sql).toMatch(/p_provider_identity_verified is not true/i);
    expect(sql).toMatch(/user_subscriptions[\s\S]*tier = 'pro'/i);
    expect(sql).toMatch(/channel_adult_attestations/i);
    expect(sql).toMatch(/on conflict \(owner_id\) do update/i);
    expect(sql).toMatch(/revoke all on function public\.complete_channel_onboarding/i);
    expect(sql).toMatch(/grant execute on function public\.complete_channel_onboarding[\s\S]*to service_role/i);
  });

  it("stores one active selection per account and exposes an active-work binding check", () => {
    const sql = migration();

    expect(sql).toMatch(/create table public\.active_connected_channel_selections/i);
    expect(sql).toMatch(/owner_id uuid[^\n]*primary key/i);
    expect(sql).toMatch(/create table public\.channel_work_items/i);
    expect(sql).toMatch(/connected_channel_id uuid not null/i);
    expect(sql).toMatch(/channel_work_items_grant_channel_fk/i);
    expect(sql).toMatch(/create or replace function public\.channel_work_item_is_publishable/i);
    expect(sql).toMatch(/active\.connected_channel_id = work\.connected_channel_id/i);
    expect(sql).toMatch(/work\.status = 'draft_ready'/i);
    expect(sql).toMatch(/connected\.status = 'active'/i);
    expect(sql).toMatch(/grant_record\.write_scope_granted is true/i);
  });

  it("does not make the eventual Channel route or navigation reachable yet", () => {
    expect(existsSync(path.resolve(__dirname, "../../app/channel"))).toBe(false);
  });
});
