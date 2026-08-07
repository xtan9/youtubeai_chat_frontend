// Central registry of gateway model IDs. Leaf module — depended on by both
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

// YouTubeAI intentionally uses one model for both summaries and chat. The
// gateway is CLIProxyAPI, which accepts the canonical Codex model ID below.
export const SPARK = "gpt-5.3-codex-spark";

// Backward-compatible aliases for legacy routing names. Both routes now use
// the same Spark model; these are not separate model choices.
/** @deprecated Use SPARK. */
export const HAIKU = SPARK;
/** @deprecated Use SPARK. */
export const SONNET = SPARK;

// The narrow union we guarantee internally. Arbitrary strings still flow
// through optional params (env var overrides) via `KnownModel | (string & {})`.
export type KnownModel = typeof SPARK;
