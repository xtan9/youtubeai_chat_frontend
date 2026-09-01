# Channel comment-assistance offline quality evaluation

The repository-side harness in `lib/channel-quality-evaluation` is the
versioned, offline release-evidence boundary for Channel comment assistance.
It evaluates captured structured observations against a frozen blind manifest;
it does not call YouTube, a model provider, the Review Queue, the Safety Flag
workflow, or Reply Draft production code.

## Corpus protocol

Build each manifest with `createChannelQualityCorpusItem` and
`freezeChannelQualityCorpus`. The item fingerprint freezes the exact bounded
input, and the manifest fingerprint covers the ordered item set, split,
reviewer provenance, governance reference, and policy version.

The harness accepts the four approved language identifiers:

* `english`
* `simplified_chinese`
* `traditional_chinese`
* `chinese_english_code_switch`

The blind manifest must be frozen and must contain, for every language, at
least 300 Allowed Criticism, 250 Actionable Abuse, 200 Reviewable Interaction,
200 Safety Flag, 50 adversarial, and 250 validator items. Every required
protected-group cross-cut has at least 100 items and `minor_safety` has at
least 200. Code-switch items carry reviewer-linked, independently meaningful
English and Chinese clause evidence. The provenance record must identify two
independent reviewers and a distinct adjudicator.

Development and blind manifests are passed separately to
`validateChannelQualityCorpora`. Item IDs, input fingerprints, policy version,
and manifest fingerprints must not overlap. A blind manifest is rejected by
`validateChannelQualityTuningCorpus`; there is no tuning escape hatch for
frozen release data.

The repository does not check in a claimed passing release corpus or release
evidence. Synthetic or separately governed data must be supplied by the
operator, and separately governed data must carry an auditable governance
reference. User or scraped YouTube comments are not an accepted corpus source.

## Result protocol

Create one `ChannelQualityEvaluationResult` for every blind item with
`createChannelQualityEvaluationResult`, then bind the complete set to the
blind manifest with `createChannelQualityResultBundle`. Each result records a
structured assessment outcome and the draft validator outcome, not raw comment
or draft text. A result distinguishes a generated model candidate from a
created Reply Draft, so Safety Flag suppression measures the final draft
boundary. The harness verifies every per-result fingerprint, the result
set fingerprint, exact item coverage, complete structured output, and the
blind-manifest binding. Missing, malformed, incomplete, contradictory, or
changed result evidence fails closed.

The release artifact records the exact `modelVersion`, `promptVersion`,
`taxonomyVersion`, `schemaVersion`, `validatorVersion`, `policyVersion`,
source revision, corpus hashes, result-set hash, composition, and evaluator
version. It reports point estimates and 95% Wilson intervals overall, for each
supported language, and for each required cross-cut. The measured metrics are:

* Actionable Abuse precision;
* Allowed Criticism false-positive rate;
* Safety Flag recall;
* Safety Flag draft suppression; and
* rejection/accepted-unsafe counts for every zero-tolerance validator
  category: `private_data`, `threat`, `impersonation`, `diagnosis`, `spam`,
  `link`, `invented_fact`, `instruction_echo`, `quoted_abuse`, `author_label`,
  `ai_verdict`, and `abusive_fallback`.

The quality gate applies the approved point and Wilson-bound thresholds. A
Safety Flag draft or any accepted unsafe zero-tolerance validator case fails
the gate. A reproducible but below-threshold run writes a failed evidence
artifact and the command exits nonzero.

## Command boundary

After the input manifests and result bundle are prepared, run:

```powershell
$env:CHANNEL_QUALITY_DEVELOPMENT_MANIFEST = 'C:\absolute\development.json'
$env:CHANNEL_QUALITY_BLIND_MANIFEST = 'C:\absolute\blind.json'
$env:CHANNEL_QUALITY_RESULTS = 'C:\absolute\results.json'
$env:CHANNEL_QUALITY_OUTPUT = 'C:\absolute\channel-quality-evidence.json'
$env:CHANNEL_QUALITY_SOURCE_REVISION = '<40-to-64-character-commit-hash>'
$env:CHANNEL_QUALITY_TUPLE_SELECTED_AT = '<ISO-time-after-blind-freeze>'
$env:CHANNEL_QUALITY_POLICY_VERSION = '<concrete-policy-version>'
$env:CHANNEL_QUALITY_MODEL_VERSION = '<exact-model-version>'
$env:CHANNEL_QUALITY_PROMPT_VERSION = '<exact-prompt-version>'
$env:CHANNEL_QUALITY_TAXONOMY_VERSION = '<exact-taxonomy-version>'
$env:CHANNEL_QUALITY_SCHEMA_VERSION = '<exact-schema-version>'
$env:CHANNEL_QUALITY_VALIDATOR_VERSION = '<exact-validator-version>'
pnpm evaluate:channel-quality
```

The command requires a clean tracked checkout whose `HEAD` matches the
declared source revision. It does not overwrite an existing output path. JSON
parse failures are reported as command failures and leave no partial output;
structurally valid below-threshold runs produce a failed artifact with a
verified reproducibility fingerprint.

The harness intentionally has no fallback adapter. Issues #473, #474, and
#476 remain explicit dependency/evidence boundaries: until their review-queue,
Safety Flag, and Reply Draft implementations provide a separately reviewed
adapter that emits this result protocol, the absence of complete observations
keeps release evidence failed. The harness never invents those upstream
behaviors or treats a synthetic fixture as production evidence.
