// Central registry of Claude model IDs. Leaf module — depended on by both
// llm-client.ts (gateway call site) and model-routing.ts (routing rules),
// with no downward dependencies of its own so both can import without
// circular-import concerns.
//
// Convention when adding a model: extend KnownModel AND export a new
// constant with the model ID. The point of this file is that
// `decision.model === HAIKU` in route code reads the same symbol that
// routing produces; a raw string literal anywhere else silently breaks
// that guarantee. This is documented convention — there's no lint rule
// enforcing it today — so reviewers should flag new gateway model
// literals that bypass this file.

// Haiku MUST include the dated suffix — CLIProxyAPI (the LLM gateway)
// resolves `claude-haiku-4-5` as "unknown provider" and returns 502,
// while the dated form routes cleanly. Sonnet 4-6 works undated because
// its alias is wired through the gateway's model list. When a new Haiku
// revision ships, update both the constant and `gh pr checks` a live
// request before merging — the gateway's `GET /v1/models` is the
// authoritative list.
export const HAIKU = "claude-haiku-4-5-20251001";
export const SONNET = "claude-sonnet-4-6";

// The narrow union we guarantee internally. Arbitrary strings still flow
// through optional params (env var overrides) via `KnownModel | (string & {})`.
export type KnownModel = typeof HAIKU | typeof SONNET;
