import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../migrations/20260901005000_channel_oauth_scope_contract.sql",
);

function migration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("Channel OAuth scope database contract", () => {
  it("stores only the canonical read and later write scope values", () => {
    const sql = migration();

    expect(sql).toMatch(/alter table public\.channel_oauth_grants/i);
    expect(sql).toMatch(/add column read_scope text/i);
    expect(sql).toMatch(
      /https:\/\/www\.googleapis\.com\/auth\/youtube\.readonly/i,
    );
    expect(sql).toMatch(/add column write_scope text/i);
    expect(sql).toMatch(
      /https:\/\/www\.googleapis\.com\/auth\/youtube\.force-ssl/i,
    );
    expect(sql).toMatch(/read_scope_value_ck/i);
    expect(sql).toMatch(/write_scope_value_ck/i);
    expect(sql).toMatch(/write_scope_granted_ck/i);
    expect(sql).not.toMatch(/access_token|refresh_token|client_secret/i);
  });

  it("requires write scope evidence whenever a grant is marked write-enabled", () => {
    const sql = migration();

    expect(sql).toMatch(
      /write_scope_granted is false[\s\S]*write_scope is null[\s\S]*write_scope_granted is true[\s\S]*write_scope = 'https:\/\/www\.googleapis\.com\/auth\/youtube\.force-ssl'/i,
    );
  });
});
