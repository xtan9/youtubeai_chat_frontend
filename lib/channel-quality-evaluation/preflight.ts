import {
  CHANNEL_QUALITY_MINIMUMS,
  CHANNEL_QUALITY_REQUIRED_CROSS_CUTS,
  CHANNEL_QUALITY_SUPPORTED_LANGUAGES,
  ChannelQualityCorpusManifestSchema,
  verifyChannelQualityCorpusFingerprint,
  hashChannelQualityValue,
  type ChannelQualityCorpusItem,
  type ChannelQualityCorpusManifest,
} from "./contracts";

export type ChannelQualityCorpusIssueCode =
  | "malformed_corpus"
  | "wrong_split"
  | "blind_corpus_not_frozen"
  | "frozen_timestamp_missing"
  | "manifest_hash_mismatch"
  | "reviewer_provenance"
  | "policy_version_missing"
  | "governance_reference_missing"
  | "duplicate_item_id"
  | "duplicate_input_hash"
  | "input_hash_mismatch"
  | "item_kind_incoherent"
  | "duplicate_cross_cut"
  | "code_switch_ineligible"
  | "minimum_sample_count"
  | "cross_cut_minimum"
  | "corpus_overlap"
  | "policy_mismatch"
  | "blind_corpus_not_tunable";

export type ChannelQualityCorpusValidationIssue = Readonly<{
  code: ChannelQualityCorpusIssueCode;
  path: string;
  detail: string;
}>;

export type ChannelQualityCorpusValidation =
  | Readonly<{
      ok: true;
      corpus: ChannelQualityCorpusManifest;
      issues: readonly [];
    }>
  | Readonly<{
      ok: false;
      issues: readonly ChannelQualityCorpusValidationIssue[];
    }>;

export function validateChannelQualityCorpus(
  value: unknown,
  options: Readonly<{
    expectedSplit?: "development" | "blind";
    requireReleaseMinimums?: boolean;
  }> = {},
): ChannelQualityCorpusValidation {
  const parsed = ChannelQualityCorpusManifestSchema.safeParse(value);
  if (!parsed.success) {
    return failure([
      issue(
        "malformed_corpus",
        "$",
        "the corpus manifest does not match the versioned schema",
      ),
    ]);
  }

  const corpus = parsed.data;
  const issues: ChannelQualityCorpusValidationIssue[] = [];
  if (options.expectedSplit && corpus.split !== options.expectedSplit) {
    issues.push(
      issue(
        "wrong_split",
        "$.split",
        `expected ${options.expectedSplit} corpus, received ${corpus.split}`,
      ),
    );
  }
  if (corpus.split === "blind" && corpus.state !== "frozen") {
    issues.push(
      issue(
        "blind_corpus_not_frozen",
        "$.state",
        "blind release input must be frozen",
      ),
    );
  }
  if (corpus.state === "frozen" && corpus.frozenAt === null) {
    issues.push(
      issue(
        "frozen_timestamp_missing",
        "$.frozenAt",
        "frozen corpora require a freeze timestamp",
      ),
    );
  }
  if (!corpus.policyVersion.trim()) {
    issues.push(
      issue(
        "policy_version_missing",
        "$.policyVersion",
        "a concrete policy version is required",
      ),
    );
  }
  if (
    corpus.dataGovernance === "separately_governed" &&
    corpus.governanceReference === null
  ) {
    issues.push(
      issue(
        "governance_reference_missing",
        "$.governanceReference",
        "separately governed data requires an auditable reference",
      ),
    );
  }
  if (!verifyChannelQualityCorpusFingerprint(corpus)) {
    issues.push(
      issue(
        "manifest_hash_mismatch",
        "$.manifestHash",
        "the manifest hash does not match its frozen contents",
      ),
    );
  }

  issues.push(...reviewerIssues(corpus));
  issues.push(...itemIssues(corpus));
  if (options.requireReleaseMinimums) {
    issues.push(...compositionIssues(corpus));
  }

  return issues.length === 0 ? { ok: true, corpus, issues: [] } : failure(issues);
}

export function validateChannelQualityCorpora(input: Readonly<{
  development: unknown;
  blind: unknown;
  requireReleaseMinimums?: boolean;
}>): ChannelQualityCorpusValidation {
  const development = validateChannelQualityCorpus(input.development, {
    expectedSplit: "development",
    requireReleaseMinimums: false,
  });
  const blind = validateChannelQualityCorpus(input.blind, {
    expectedSplit: "blind",
    requireReleaseMinimums: input.requireReleaseMinimums ?? true,
  });
  const issues: ChannelQualityCorpusValidationIssue[] = [];
  if (!development.ok) issues.push(...development.issues);
  if (!blind.ok) issues.push(...blind.issues);
  if (development.ok && blind.ok) {
    if (development.corpus.policyVersion !== blind.corpus.policyVersion) {
      issues.push(
        issue(
          "policy_mismatch",
          "$.blind.policyVersion",
          "development and blind corpora must use the same policy version",
        ),
      );
    }
    const developmentIds = new Set(
      development.corpus.items.map((corpusItem) => corpusItem.id),
    );
    const developmentHashes = new Set(
      development.corpus.items.map((corpusItem) => corpusItem.inputSha256),
    );
    for (const corpusItem of blind.corpus.items) {
      if (developmentIds.has(corpusItem.id)) {
        issues.push(
          issue(
            "corpus_overlap",
            `$.blind.items[${corpusItem.id}]`,
            "an item id appears in both development and blind corpora",
          ),
        );
      }
      if (developmentHashes.has(corpusItem.inputSha256)) {
        issues.push(
          issue(
            "corpus_overlap",
            `$.blind.items[${corpusItem.id}].inputSha256`,
            "an input fingerprint appears in both development and blind corpora",
          ),
        );
      }
    }
    if (development.corpus.manifestHash === blind.corpus.manifestHash) {
      issues.push(
        issue(
          "corpus_overlap",
          "$.blind.manifestHash",
          "development and blind manifests must be distinct",
        ),
      );
    }
  }
  return issues.length === 0
    ? development.ok && blind.ok
      ? { ok: true, corpus: blind.corpus, issues: [] }
      : failure([
          issue(
            "malformed_corpus",
            "$",
            "both development and blind corpora are required",
          ),
        ])
    : failure(issues);
}

export function validateChannelQualityTuningCorpus(
  value: unknown,
): ChannelQualityCorpusValidation {
  const parsed = ChannelQualityCorpusManifestSchema.safeParse(value);
  if (parsed.success && parsed.data.split === "blind") {
    return failure([
      issue(
        "blind_corpus_not_tunable",
        "$.split",
        "a frozen blind manifest is release-only and cannot be supplied to tuning",
      ),
    ]);
  }
  return validateChannelQualityCorpus(value, {
    expectedSplit: "development",
    requireReleaseMinimums: false,
  });
}

function reviewerIssues(
  corpus: ChannelQualityCorpusManifest,
): ChannelQualityCorpusValidationIssue[] {
  const issues: ChannelQualityCorpusValidationIssue[] = [];
  const reviewers = corpus.reviewers.reviewers;
  const ids = new Set(reviewers.map((reviewer) => reviewer.id));
  const roles = new Set(reviewers.map((reviewer) => reviewer.role));
  if (
    reviewers.length < 3 ||
    ids.size !== reviewers.length ||
    roles.size !== 3 ||
    !roles.has("primary") ||
    !roles.has("secondary") ||
    !roles.has("adjudicator")
  ) {
    issues.push(
      issue(
        "reviewer_provenance",
        "$.reviewers",
        "two independent reviewers and one distinct adjudicator are required",
      ),
    );
  }
  return issues;
}

function itemIssues(
  corpus: ChannelQualityCorpusManifest,
): ChannelQualityCorpusValidationIssue[] {
  const issues: ChannelQualityCorpusValidationIssue[] = [];
  const ids = new Set<string>();
  const inputHashes = new Set<string>();
  const reviewerIds = new Set(
    corpus.reviewers.reviewers.map((reviewer) => reviewer.id),
  );
  for (const [index, corpusItem] of corpus.items.entries()) {
    const path = `$.items[${index}]`;
    if (ids.has(corpusItem.id)) {
      issues.push(issue("duplicate_item_id", `${path}.id`, "item id repeats"));
    }
    ids.add(corpusItem.id);
    if (inputHashes.has(corpusItem.inputSha256)) {
      issues.push(
        issue(
          "duplicate_input_hash",
          `${path}.inputSha256`,
          "input fingerprint repeats within a corpus",
        ),
      );
    }
    inputHashes.add(corpusItem.inputSha256);
    if (hashChannelQualityValue(corpusItem.input) !== corpusItem.inputSha256) {
      issues.push(
        issue(
          "input_hash_mismatch",
          `${path}.inputSha256`,
          "the item input changed after it was fingerprinted",
        ),
      );
    }
    if (new Set(corpusItem.crossCuts).size !== corpusItem.crossCuts.length) {
      issues.push(
        issue(
          "duplicate_cross_cut",
          `${path}.crossCuts`,
          "a cross-cut cannot be listed more than once",
        ),
      );
    }
    const isValidator = corpusItem.kind === "validator";
    const hasClassification = corpusItem.expectedClassification !== null;
    const hasValidatorCategory = corpusItem.expectedValidatorCategory !== null;
    if (isValidator !== hasValidatorCategory || (!isValidator && !hasClassification)) {
      issues.push(
        issue(
          "item_kind_incoherent",
          path,
          "validator items need a validator category; all other items need a gold classification",
        ),
      );
    }
    if (
      corpusItem.language === "chinese_english_code_switch" &&
      !isEligibleCodeSwitch(corpusItem, reviewerIds)
    ) {
      issues.push(
        issue(
          "code_switch_ineligible",
          `${path}.codeSwitchEvidence`,
          "code-switch items require independently meaningful reviewed English and Chinese clauses",
        ),
      );
    }
    if (
      corpusItem.language !== "chinese_english_code_switch" &&
      corpusItem.codeSwitchEvidence !== null
    ) {
      issues.push(
        issue(
          "code_switch_ineligible",
          `${path}.codeSwitchEvidence`,
          "code-switch evidence is only valid for the code-switch slice",
        ),
      );
    }
  }
  return issues;
}

function compositionIssues(
  corpus: ChannelQualityCorpusManifest,
): ChannelQualityCorpusValidationIssue[] {
  const issues: ChannelQualityCorpusValidationIssue[] = [];
  for (const language of CHANNEL_QUALITY_SUPPORTED_LANGUAGES) {
    const items = corpus.items.filter((corpusItem) => corpusItem.language === language);
    const classified = items.filter(
      (corpusItem) => corpusItem.kind === "classification",
    );
    const adversarial = items.filter(
      (corpusItem) => corpusItem.kind === "adversarial",
    );
    const validators = items.filter(
      (corpusItem) => corpusItem.kind === "validator",
    );
    const counts = new Map<string, number>();
    for (const corpusItem of classified) {
      const label = corpusItem.expectedClassification!;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const minimums = CHANNEL_QUALITY_MINIMUMS.perLanguage.classifications;
    if (
      classified.length + adversarial.length <
      CHANNEL_QUALITY_MINIMUMS.perLanguage.totalClassificationAndAdversarial
    ) {
      issues.push(
        issue(
          "minimum_sample_count",
          `$.items[language=${language}]`,
          "the language slice has fewer than 1,000 classification/adversarial items",
        ),
      );
    }
    for (const [label, minimum] of Object.entries(minimums)) {
      if ((counts.get(label) ?? 0) < minimum) {
        issues.push(
          issue(
            "minimum_sample_count",
            `$.items[language=${language}].expectedClassification=${label}`,
            `the language slice requires at least ${minimum} items`,
          ),
        );
      }
    }
    if (adversarial.length < CHANNEL_QUALITY_MINIMUMS.perLanguage.adversarial) {
      issues.push(
        issue(
          "minimum_sample_count",
          `$.items[language=${language}].kind=adversarial`,
          "the language slice requires at least 50 adversarial items",
        ),
      );
    }
    if (validators.length < CHANNEL_QUALITY_MINIMUMS.perLanguage.validator) {
      issues.push(
        issue(
          "minimum_sample_count",
          `$.items[language=${language}].kind=validator`,
          "the language slice requires at least 250 validator items",
        ),
      );
    }
  }

  for (const crossCut of CHANNEL_QUALITY_REQUIRED_CROSS_CUTS) {
    const count = corpus.items.filter((corpusItem) =>
      corpusItem.crossCuts.includes(crossCut),
    ).length;
    if (count < CHANNEL_QUALITY_MINIMUMS.eachRequiredCrossCut) {
      issues.push(
        issue(
          "cross_cut_minimum",
          `$.items[crossCut=${crossCut}]`,
          `the required cross-cut has ${count} items; at least ${CHANNEL_QUALITY_MINIMUMS.eachRequiredCrossCut} are required`,
        ),
      );
    }
  }
  const minorSafetyCount = corpus.items.filter((corpusItem) =>
    corpusItem.crossCuts.includes("minor_safety"),
  ).length;
  if (minorSafetyCount < CHANNEL_QUALITY_MINIMUMS.minorSafety) {
    issues.push(
      issue(
        "cross_cut_minimum",
        "$.items[crossCut=minor_safety]",
        `minor safety requires at least ${CHANNEL_QUALITY_MINIMUMS.minorSafety} items`,
      ),
    );
  }
  return issues;
}

function isEligibleCodeSwitch(
  corpusItem: ChannelQualityCorpusItem,
  reviewerIds: ReadonlySet<string>,
): boolean {
  const evidence = corpusItem.codeSwitchEvidence;
  if (!evidence || !reviewerIds.has(evidence.reviewedBy)) return false;
  const englishWords = evidence.englishClause.match(/[A-Za-z]+/g) ?? [];
  const chineseCharacters = evidence.chineseClause.match(/[\u3400-\u9fff]/gu) ?? [];
  return (
    evidence.independentlyMeaningful &&
    englishWords.length >= 2 &&
    chineseCharacters.length >= 3
  );
}

function failure(
  issues: readonly ChannelQualityCorpusValidationIssue[],
): ChannelQualityCorpusValidation {
  return { ok: false, issues };
}

function issue(
  code: ChannelQualityCorpusIssueCode,
  path: string,
  detail: string,
): ChannelQualityCorpusValidationIssue {
  return { code, path, detail };
}
