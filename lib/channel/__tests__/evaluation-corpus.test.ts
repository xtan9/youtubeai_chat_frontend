import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ENGLISH_BLIND_CORPUS_MINIMUMS,
  PROTECTED_GROUP_CROSS_CUTS,
  ChannelEnglishBlindCorpusApprovalEvidenceSchema,
  ChannelEnglishBlindCorpusManifestDescriptorSchema,
  assertApprovedFrozenChannelEvaluationCorpus,
  channelEvaluationCorpusFingerprint,
  createEnglishBlindEvaluationCorpus,
  summarizeChannelEvaluationCorpus,
  validateChannelEvaluationCorpus,
} from "../evaluation-corpus-governance";

import pendingManifest from "../../../docs/evaluation/channel/simplified-chinese-blind-corpus.manifest.json";
import pendingEvidence from "../../../docs/evaluation/channel/simplified-chinese-blind-corpus-approval-freeze-evidence.json";
import {
  CHANNEL_BLIND_CORPUS_REQUIREMENTS,
  PROTECTED_GROUP_CROSS_CUTS as SIMPLIFIED_PROTECTED_GROUP_CROSS_CUTS,
  SimplifiedChineseBlindCorpusApprovalFreezeEvidenceSchema,
  computeSimplifiedChineseBlindCorpusDigest,
  authorizeSimplifiedChineseBlindCorpusUse,
  validateSimplifiedChineseBlindCorpus,
} from "../evaluation-corpus";


const REPOSITORY_ROOT = path.resolve(__dirname, "../../..");

const REVIEWED_AT = "2026-09-01T12:00:00.000Z";

function withConsensusReviews(
  corpus: ReturnType<typeof createEnglishBlindEvaluationCorpus>,
) {
  const items = corpus.items.map((item) => ({
    ...item,
    reviewerProvenance: {
      status: "complete" as const,
      independentLabels: [
        { reviewerId: "reviewer-a", label: item.category, labeledAt: REVIEWED_AT },
        { reviewerId: "reviewer-b", label: item.category, labeledAt: REVIEWED_AT },
      ],
      adjudication: null,
      finalLabel: item.category,
    },
  }));
  return {
    ...corpus,
    items,
    declaredCoverage: summarizeChannelEvaluationCorpus({ items }),
  };
}

function withRecordedApprovalAndFreeze(
  corpus: ReturnType<typeof withConsensusReviews>,
) {
  const corpusFingerprint = channelEvaluationCorpusFingerprint(corpus);
  return {
    ...corpus,
    status: "frozen" as const,
    approval: {
      status: "recorded" as const,
      corpusFingerprint,
      approvedAt: "2026-09-01T13:00:00.000Z",
      approvedBy: "named-human-approver",
      evidenceReference: "evidence://channel-483/approval",
    },
    freeze: {
      status: "recorded" as const,
      corpusFingerprint,
      frozenAt: "2026-09-01T14:00:00.000Z",
      frozenBy: "named-human-freeze-owner",
      evidenceReference: "evidence://channel-483/freeze",
    },
    finalTupleEvaluation: {
      status: "available" as const,
      startedAt: "2026-09-01T15:00:00.000Z",
      tupleFingerprint: null,
    },
    upstreamHarness: {
      issueNumber: 482 as const,
      status: "available" as const,
      sourceRevision: "b".repeat(40),
      evidenceReference: "evidence://channel-483/harness",
    },
  };
}

describe("English blind evaluation corpus governance", () => {
  it("materializes the required inventory without treating it as approved evidence", () => {
    const corpus = createEnglishBlindEvaluationCorpus();
    const report = validateChannelEvaluationCorpus(corpus);

    expect(report.valid).toBe(true);
    expect(report.releaseReady).toBe(false);
    expect(report.coverage).toMatchObject({
      totalItems: ENGLISH_BLIND_CORPUS_MINIMUMS.totalItems,
      categoryCounts: {
        "Allowed Criticism": 300,
        "Actionable Abuse": 250,
        "Reviewable Interaction": 200,
        "Safety Flag": 250,
      },
      adversarialCount: 50,
      zeroToleranceValidatorCount: 250,
      minorSafetyCount: 200,
    });
    expect(
      PROTECTED_GROUP_CROSS_CUTS.every(
        (crossCut) =>
          report.coverage.protectedGroupCounts[crossCut] >=
          ENGLISH_BLIND_CORPUS_MINIMUMS.protectedGroupCrossCutItems,
      ),
    ).toBe(true);
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        "reviewer_provenance_incomplete",
        "approval_not_recorded",
        "freeze_not_recorded",
      ]),
    );
  });

  it("requires item-level provenance and rejects YouTube API comment origins", () => {
    const corpus = createEnglishBlindEvaluationCorpus();

    expect(
      corpus.items.every(
        (item) =>
          item.origin.reference.startsWith("synthetic://") &&
          item.rights.basis === "original_synthetic" &&
          item.deidentification.status === "not_applicable_synthetic" &&
          item.policyVersion === corpus.policyVersion &&
          item.reviewerProvenance.status === "pending",
      ),
    ).toBe(true);

    const apiOriginCorpus = {
      ...corpus,
      items: [
        {
          ...corpus.items[0],
          origin: {
            ...corpus.items[0].origin,
            kind: "youtube_api_comment",
          },
        },
        ...corpus.items.slice(1),
      ],
    };
    const report = validateChannelEvaluationCorpus(apiOriginCorpus);

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain(
      "youtube_api_comment_origin_forbidden",
    );
  });

  it("requires separate consent, license, and de-identification evidence for Creator examples", () => {
    const corpus = createEnglishBlindEvaluationCorpus();
    const creatorExampleCorpus = {
      ...corpus,
      items: [
        {
          ...corpus.items[0],
          origin: {
            ...corpus.items[0].origin,
            kind: "creator_example",
            reference: "evidence://creator-example/pending",
          },
        },
        ...corpus.items.slice(1),
      ],
    };

    const report = validateChannelEvaluationCorpus(creatorExampleCorpus);

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "creator_rights_not_separately_evidenced",
        "creator_deidentification_not_evidenced",
      ]),
    );
  });

  it("requires two independent labels and a distinct third reviewer for disagreements", () => {
    const corpus = withConsensusReviews(createEnglishBlindEvaluationCorpus());
    const disagreement = {
      ...corpus.items[0].reviewerProvenance,
      independentLabels: [
        {
          reviewerId: "reviewer-a",
          label: "Allowed Criticism" as const,
          labeledAt: REVIEWED_AT,
        },
        {
          reviewerId: "reviewer-b",
          label: "Actionable Abuse" as const,
          labeledAt: REVIEWED_AT,
        },
      ],
      finalLabel: "Allowed Criticism" as const,
    };
    const withoutAdjudication = {
      ...corpus,
      items: [
        {
          ...corpus.items[0],
          reviewerProvenance: disagreement,
        },
        ...corpus.items.slice(1),
      ],
    };
    const missingAdjudicatorReport = validateChannelEvaluationCorpus(
      withoutAdjudication,
    );
    expect(missingAdjudicatorReport.issues.map((issue) => issue.code)).toContain(
      "adjudication_missing",
    );

    const resolved = {
      ...withoutAdjudication,
      items: [
        {
          ...withoutAdjudication.items[0],
          reviewerProvenance: {
            ...disagreement,
            adjudication: {
              reviewerId: "reviewer-c",
              label: "Allowed Criticism" as const,
              labeledAt: REVIEWED_AT,
            },
          },
        },
        ...withoutAdjudication.items.slice(1),
      ],
    };
    const resolvedReport = validateChannelEvaluationCorpus(resolved);

    expect(resolvedReport.valid).toBe(true);
    expect(resolvedReport.blockers).not.toContain(
      "reviewer_provenance_incomplete",
    );
  });

  it("only releases a corpus after explicit approval, freeze, and harness evidence", () => {
    const readyCorpus = withRecordedApprovalAndFreeze(
      withConsensusReviews(createEnglishBlindEvaluationCorpus()),
    );
    const readyReport = validateChannelEvaluationCorpus(readyCorpus);

    expect(readyReport.valid).toBe(true);
    expect(readyReport.releaseReady).toBe(true);
    expect(readyReport.blockers).toEqual([]);

    const evaluatedBeforeFreeze = {
      ...readyCorpus,
      finalTupleEvaluation: {
        ...readyCorpus.finalTupleEvaluation,
        startedAt: "2026-09-01T13:30:00.000Z",
      },
    };
    const orderingReport = validateChannelEvaluationCorpus(
      evaluatedBeforeFreeze,
    );

    expect(orderingReport.valid).toBe(false);
    expect(orderingReport.issues.map((issue) => issue.code)).toContain(
      "tuple_evaluation_started_before_freeze",
    );
  });

  it("cannot be enabled for tuning", () => {
    const corpus = createEnglishBlindEvaluationCorpus();
    const report = validateChannelEvaluationCorpus({
      ...corpus,
      tuning: {
        allowed: true,
        prohibition: "not actually prohibited",
      },
    });

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain("schema_invalid");
  });

  it("keeps multilingual synthetic authoring and minor-safety labels explicit", () => {
    const corpus = createEnglishBlindEvaluationCorpus();
    const firstItem = corpus.items[0];
    const invalidCorpus = {
      ...corpus,
      items: [
        {
          ...firstItem,
          origin: {
            ...firstItem.origin,
            authoringLanguages: ["en" as const],
          },
          minorSafety: true,
        },
        ...corpus.items.slice(1),
      ],
    };

    const report = validateChannelEvaluationCorpus(invalidCorpus);

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "synthetic_authoring_not_multilingual",
        "minor_safety_not_safety_flag",
      ]),
    );
  });

  it("exposes a fail-closed assertion for final tuple consumers", () => {
    expect(() =>
      assertApprovedFrozenChannelEvaluationCorpus(
        createEnglishBlindEvaluationCorpus(),
      ),
    ).toThrow(/not approved and frozen/);

    const readyCorpus = withRecordedApprovalAndFreeze(
      withConsensusReviews(createEnglishBlindEvaluationCorpus()),
    );
    expect(assertApprovedFrozenChannelEvaluationCorpus(readyCorpus)).toEqual(
      readyCorpus,
    );
  });

  it("keeps the checked-in manifest and pending evidence machine-valid", () => {
    const manifest = JSON.parse(
      readFileSync(
        path.join(
          REPOSITORY_ROOT,
          "docs/channel-evaluation/english-blind-corpus-manifest.json",
        ),
        "utf8",
      ),
    ) as unknown;
    const evidence = JSON.parse(
      readFileSync(
        path.join(
          REPOSITORY_ROOT,
          "docs/compliance/channel-english-blind-corpus-approval.json",
        ),
        "utf8",
      ),
    ) as unknown;
    const parsedManifest =
      ChannelEnglishBlindCorpusManifestDescriptorSchema.safeParse(manifest);
    const parsedEvidence =
      ChannelEnglishBlindCorpusApprovalEvidenceSchema.safeParse(evidence);
    const report = validateChannelEvaluationCorpus(
      createEnglishBlindEvaluationCorpus(),
    );

    expect(parsedManifest.success).toBe(true);
    expect(parsedEvidence.success).toBe(true);
    if (!parsedManifest.success || !parsedEvidence.success) return;
    expect(parsedManifest.data.declaredCoverage).toEqual(report.coverage);
    expect(parsedEvidence.data.approval.status).toBe("not_recorded");
    expect(parsedEvidence.data.freeze.status).toBe("not_recorded");
    expect(parsedEvidence.data.finalTupleEvaluation.status).toBe("blocked");
    expect(parsedEvidence.data.originPolicy.creatorExamplesIncluded).toBe(0);
  });

  it("binds approval and freeze evidence to the exact corpus contents", () => {
    const corpus = createEnglishBlindEvaluationCorpus();
    const fingerprint = channelEvaluationCorpusFingerprint(corpus);
    const changedCorpus = {
      ...corpus,
      items: [
        {
          ...corpus.items[0],
          text: `${corpus.items[0].text} changed`,
        },
        ...corpus.items.slice(1),
      ],
    };

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(channelEvaluationCorpusFingerprint(corpus)).toBe(fingerprint);
    expect(channelEvaluationCorpusFingerprint(changedCorpus)).not.toBe(
      fingerprint,
    );
  });

  it("does not accept machine-like approval identities", () => {
    const readyCorpus = withRecordedApprovalAndFreeze(
      withConsensusReviews(createEnglishBlindEvaluationCorpus()),
    );
    const report = validateChannelEvaluationCorpus({
      ...readyCorpus,
      approval: {
        ...readyCorpus.approval,
        approvedBy: "approval-bot",
      },
    });

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain(
      "automated_approval_forbidden",
    );
  });

  it("does not accept machine-like item reviewers", () => {
    const readyCorpus = withRecordedApprovalAndFreeze(
      withConsensusReviews(createEnglishBlindEvaluationCorpus()),
    );
    const report = validateChannelEvaluationCorpus({
      ...readyCorpus,
      items: [
        {
          ...readyCorpus.items[0],
          reviewerProvenance: {
            ...readyCorpus.items[0].reviewerProvenance,
            independentLabels: [
              {
                reviewerId: "reviewer-bot",
                label: readyCorpus.items[0].category,
                labeledAt: REVIEWED_AT,
              },
              readyCorpus.items[0].reviewerProvenance.independentLabels[1],
            ],
          },
        },
        ...readyCorpus.items.slice(1),
      ],
    });

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain(
      "automated_reviewer_forbidden",
    );
  });

  it("requires a fingerprint for a completed tuple evaluation", () => {
    const readyCorpus = withRecordedApprovalAndFreeze(
      withConsensusReviews(createEnglishBlindEvaluationCorpus()),
    );
    const report = validateChannelEvaluationCorpus({
      ...readyCorpus,
      finalTupleEvaluation: {
        status: "completed",
        startedAt: "2026-09-01T15:00:00.000Z",
        tupleFingerprint: null,
      },
    });

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain(
      "tuple_fingerprint_missing",
    );
  });
});

const POLICY_VERSION = "youtube-hate-speech-policy-test-v1";
const REVIEW_PROTOCOL_VERSION = "channel-blind-review-v1";
const SIMPLIFIED_REVIEWED_AT = "2026-09-01T00:00:00.000Z";
const SOURCE_REVISION = "a".repeat(40);

type BlindStratum = keyof typeof CHANNEL_BLIND_CORPUS_REQUIREMENTS.strata;

const VALIDATOR_CLASSES = [
  "privacy",
  "threat",
  "impersonation",
  "diagnosis",
  "spam",
  "malicious_link",
  "instruction_echo",
] as const;

function reviewProvenance(
  label: string,
  overrides: Readonly<{
    secondLabel?: string;
    adjudication?: Readonly<{
      reviewerId?: string;
      label: string;
    }> | null;
    duplicateReviewer?: boolean;
  }> = {},
) {
  const secondReviewerId = overrides.duplicateReviewer
    ? "fixture-reviewer-1"
    : "fixture-reviewer-2";
  const secondLabel = overrides.secondLabel ?? label;
  const independentReviews = [
    {
      reviewerId: "fixture-reviewer-1",
      assignmentId: "fixture-assignment-1",
      role: "independent",
      label,
      reviewedAt: SIMPLIFIED_REVIEWED_AT,
    },
    {
      reviewerId: secondReviewerId,
      assignmentId: "fixture-assignment-2",
      role: "independent",
      label: secondLabel,
      reviewedAt: SIMPLIFIED_REVIEWED_AT,
    },
  ];

  const adjudication =
    overrides.adjudication === undefined
      ? null
      : overrides.adjudication === null
        ? null
        : {
            reviewerId:
              overrides.adjudication.reviewerId ?? "fixture-adjudicator",
            role: "adjudicator",
            label: overrides.adjudication.label,
            reviewedAt: SIMPLIFIED_REVIEWED_AT,
            rationaleRef: "test://issue-484/adjudication",
          };

  return {
    protocolVersion: REVIEW_PROTOCOL_VERSION,
    independentReviews,
    adjudication,
  };
}

function blindItem(
  index: number,
  stratum: BlindStratum,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  const expectedClassification =
    stratum === "prompt_injection_adversarial"
      ? "allowed_criticism"
      : stratum;

  return {
    id: `fixture-blind-${index}`,
    language: "simplified_chinese",
    text: `这是用于治理测试的合成项目 ${index}。`,
    stratum,
    expectedClassification,
    protectedGroupCrossCuts: [],
    minorSafety: false,
    origin: {
      kind: "authored_synthetic",
      reference: `synthetic://issue-484/${index}`,
      youtubeApiData: false,
    },
    rights: {
      status: "synthetic",
      basis: "Authored only for a test fixture; no person or platform data.",
      evidenceRef: null,
    },
    deIdentification: {
      status: "not_applicable_synthetic",
      method: "No person-derived source exists.",
      evidenceRef: null,
    },
    policyVersion: POLICY_VERSION,
    reviewerProvenance: reviewProvenance(expectedClassification),
    ...overrides,
  };
}

function validatorItem(index: number) {
  return {
    id: `fixture-validator-${index}`,
    language: "simplified_chinese",
    text: `这是用于零容忍验证器治理测试的合成项目 ${index}。`,
    validatorClass: VALIDATOR_CLASSES[index % VALIDATOR_CLASSES.length],
    expectedOutcome: "reject",
    origin: {
      kind: "authored_synthetic",
      reference: `synthetic://issue-484/validator/${index}`,
      youtubeApiData: false,
    },
    rights: {
      status: "synthetic",
      basis: "Authored only for a test fixture; no person or platform data.",
      evidenceRef: null,
    },
    deIdentification: {
      status: "not_applicable_synthetic",
      method: "No person-derived source exists.",
      evidenceRef: null,
    },
    policyVersion: POLICY_VERSION,
    reviewerProvenance: reviewProvenance("reject"),
  };
}

function completeManifest() {
  const blindItems: Array<Record<string, unknown>> = [
    ...Array.from({ length: 300 }, (_, index) =>
      blindItem(index, "allowed_criticism"),
    ),
    ...Array.from({ length: 250 }, (_, index) =>
      blindItem(300 + index, "actionable_abuse"),
    ),
    ...Array.from({ length: 200 }, (_, index) =>
      blindItem(550 + index, "reviewable_interaction"),
    ),
    ...Array.from({ length: 200 }, (_, index) =>
      blindItem(750 + index, "safety_flag"),
    ),
    ...Array.from({ length: 50 }, (_, index) =>
      blindItem(950 + index, "prompt_injection_adversarial"),
    ),
  ];

  for (const [groupIndex, group] of SIMPLIFIED_PROTECTED_GROUP_CROSS_CUTS.entries()) {
    for (let itemIndex = 0; itemIndex < 100; itemIndex += 1) {
      const index = groupIndex * 100 + itemIndex;
      blindItems[index] = {
        ...blindItems[index],
        protectedGroupCrossCuts: [group],
      };
    }
  }

  for (let index = 750; index < 950; index += 1) {
    blindItems[index] = {
      ...blindItems[index],
      minorSafety: true,
    };
  }

  const manifest = {
    recordType: "channel-evaluation-corpus-manifest",
    recordVersion: 1,
    issueNumber: 484,
    language: "simplified_chinese",
    languageTag: "zh-Hans",
    policyVersion: POLICY_VERSION,
    purpose: "blind_tuple_evaluation",
    storage: {
      content: "controlled_external_store_not_checked_in",
      youtubeApiCommentsPermanentCorpus: "prohibited",
      trainingUse: "prohibited",
      allowedUse: "final_tuple_evaluation_only",
    },
    reviewProtocol: {
      protocolVersion: REVIEW_PROTOCOL_VERSION,
      independentReviewerCount: 2,
      adjudicatorCount: 1,
      adjudicationRequiredOnDisagreement: true,
    },
    requirements: CHANNEL_BLIND_CORPUS_REQUIREMENTS,
    blindItems,
    zeroToleranceValidatorItems: Array.from({ length: 250 }, (_, index) =>
      validatorItem(index),
    ),
    reportedCounts: {
      blindTotal: 1000,
      blindByStratum: {
        allowed_criticism: 300,
        actionable_abuse: 250,
        reviewable_interaction: 200,
        safety_flag: 200,
        prompt_injection_adversarial: 50,
      },
      zeroToleranceValidatorTotal: 250,
      zeroToleranceByClass: {
        privacy: 36,
        threat: 36,
        impersonation: 36,
        diagnosis: 36,
        spam: 36,
        malicious_link: 35,
        instruction_echo: 35,
      },
      protectedGroupCrossCuts: Object.fromEntries(
        SIMPLIFIED_PROTECTED_GROUP_CROSS_CUTS.map((group) => [group, 100]),
      ),
      minorSafety: 200,
    },
    approval: {
      status: "approved",
      approvedBy: {
        kind: "human",
        reviewerId: "fixture-human-approval-record",
      },
      approvedAt: SIMPLIFIED_REVIEWED_AT,
      evidenceRef: "test://issue-484/approval",
    },
    freeze: {
      status: "frozen",
      frozenBy: "fixture-freeze-record",
      frozenAt: SIMPLIFIED_REVIEWED_AT,
      manifestDigest: "0".repeat(64),
      sourceRevision: SOURCE_REVISION,
      frozenBeforeFinalTupleEvaluation: true,
      evidenceRef: "test://issue-484/freeze",
    },
    upstreamHarness: {
      issueNumber: 482,
      status: "available",
      evidenceRef: "test://issue-482/harness",
    },
  };

  return {
    ...manifest,
    freeze: {
      ...manifest.freeze,
      manifestDigest: computeSimplifiedChineseBlindCorpusDigest(manifest),
    },
  };
}

function replaceBlindItem(
  manifest: ReturnType<typeof completeManifest>,
  index: number,
  replacement: Record<string, unknown>,
) {
  return {
    ...manifest,
    blindItems: manifest.blindItems.map((item, itemIndex) =>
      itemIndex === index ? replacement : item,
    ),
  };
}

describe("Simplified Chinese blind corpus governance", () => {
  it("records explicit negative approval and freeze evidence without claiming readiness", () => {
    expect(
      SimplifiedChineseBlindCorpusApprovalFreezeEvidenceSchema.safeParse(
        pendingEvidence,
      ).success,
    ).toBe(true);
    expect(pendingEvidence).toMatchObject({
      status: "blocked",
      approval: { status: "not_evidenced", evidenceRef: null },
      freeze: { status: "not_evidenced", evidenceRef: null },
      upstreamHarness: { issueNumber: 482, status: "blocked_by_issue_482" },
      negativeControls: {
        licensedExamplesCheckedIn: false,
        humanApprovalsFabricated: false,
        youtubeApiCommentsScrapedIntoPermanentCorpus: false,
        blindCorpusAvailableForTuning: false,
      },
    });
  });

  it("keeps the checked-in corpus blocked without inventing corpus or approval evidence", () => {
    const report = validateSimplifiedChineseBlindCorpus(pendingManifest);

    expect(report.status).toBe("blocked");
    expect(report.counts).toMatchObject({
      blindTotal: 0,
      zeroToleranceValidatorTotal: 0,
      minorSafety: 0,
    });
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "blind_items_below_minimum",
        "zero_tolerance_items_below_minimum",
        "protected_group_cross_cut_below_minimum",
        "minor_safety_items_below_minimum",
        "approval_not_evidenced",
        "freeze_not_evidenced",
        "upstream_harness_blocked",
      ]),
    );
    expect(
      authorizeSimplifiedChineseBlindCorpusUse(
        pendingManifest,
        "final_tuple_evaluation",
      ),
    ).toMatchObject({ allowed: false });
  });

  it("authorizes only a fully governed frozen corpus for final tuple evaluation", () => {
    const manifest = completeManifest();
    const report = validateSimplifiedChineseBlindCorpus(manifest);

    expect(report).toMatchObject({
      status: "ready",
      counts: {
        blindTotal: 1000,
        zeroToleranceValidatorTotal: 250,
        minorSafety: 200,
      },
    });
    expect(report.counts.blindByStratum).toEqual({
      allowed_criticism: 300,
      actionable_abuse: 250,
      reviewable_interaction: 200,
      safety_flag: 200,
      prompt_injection_adversarial: 50,
    });
    expect(
      authorizeSimplifiedChineseBlindCorpusUse(
        manifest,
        "final_tuple_evaluation",
      ),
    ).toMatchObject({ allowed: true });
    expect(
      authorizeSimplifiedChineseBlindCorpusUse(manifest, "tuning"),
    ).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/tuning/i),
    });
  });

  it("requires traceable protected-group and minor-safety counts", () => {
    const manifest = completeManifest();
    const blindItems = manifest.blindItems.map((item, index) => {
      if (index === 0) {
        return { ...item, protectedGroupCrossCuts: [] };
      }
      if (index === 750) return { ...item, minorSafety: false };
      return item;
    });
    const report = validateSimplifiedChineseBlindCorpus({
      ...manifest,
      blindItems,
    });

    expect(report.status).toBe("blocked");
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "reported_count_mismatch",
        "protected_group_cross_cut_below_minimum",
        "minor_safety_items_below_minimum",
      ]),
    );
  });

  it("requires two distinct independent labels and adjudication only for disagreement", () => {
    const manifest = completeManifest();
    const disagreeingItem = {
      ...manifest.blindItems[0],
      reviewerProvenance: reviewProvenance("allowed_criticism", {
        secondLabel: "actionable_abuse",
      }),
    };
    const withoutAdjudication = replaceBlindItem(
      manifest,
      0,
      disagreeingItem,
    );
    const blocked = validateSimplifiedChineseBlindCorpus(withoutAdjudication);
    expect(blocked.issues.map((issue) => issue.code)).toContain(
      "adjudication_required",
    );

    const resolved = replaceBlindItem(manifest, 0, {
      ...disagreeingItem,
      reviewerProvenance: reviewProvenance("allowed_criticism", {
        secondLabel: "actionable_abuse",
        adjudication: { label: "allowed_criticism" },
      }),
    });
    const resolvedReport = validateSimplifiedChineseBlindCorpus({
      ...resolved,
      freeze: {
        ...resolved.freeze,
        manifestDigest: computeSimplifiedChineseBlindCorpusDigest(resolved),
      },
    });
    expect(resolvedReport.issues.map((issue) => issue.code)).not.toContain(
      "adjudication_required",
    );

    const duplicateReviewer = replaceBlindItem(manifest, 0, {
      ...manifest.blindItems[0],
      reviewerProvenance: reviewProvenance("allowed_criticism", {
        duplicateReviewer: true,
      }),
    });
    expect(
      validateSimplifiedChineseBlindCorpus(duplicateReviewer).issues.map(
        (issue) => issue.code,
      ),
    ).toContain("independent_reviewers_not_distinct");
  });

  it("rejects YouTube API provenance and unproven governed rights", () => {
    const manifest = completeManifest();
    const firstItem = manifest.blindItems[0]!;
    const secondItem = manifest.blindItems[1]!;
    const apiItem = {
      ...firstItem,
      origin: {
        ...(firstItem.origin as Record<string, unknown>),
        youtubeApiData: true,
      },
    };
    const licensedItem = {
      ...secondItem,
      origin: {
        ...(secondItem.origin as Record<string, unknown>),
        kind: "licensed_deidentified",
      },
      rights: {
        ...(secondItem.rights as Record<string, unknown>),
        status: "licensed",
        evidenceRef: null,
      },
      deIdentification: {
        ...(secondItem.deIdentification as Record<string, unknown>),
        status: "verified",
        evidenceRef: null,
      },
    };
    const report = validateSimplifiedChineseBlindCorpus({
      ...manifest,
      blindItems: [apiItem, licensedItem, ...manifest.blindItems.slice(2)],
    });

    expect(report.status).toBe("blocked");
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "youtube_api_data_prohibited",
        "rights_evidence_missing",
        "de_identification_evidence_missing",
      ]),
    );
  });

  it("fails closed when freeze evidence does not match the governed corpus digest", () => {
    const manifest = completeManifest();
    const report = validateSimplifiedChineseBlindCorpus({
      ...manifest,
      freeze: {
        ...manifest.freeze,
        manifestDigest: "f".repeat(64),
      },
    });

    expect(report.status).toBe("blocked");
    expect(report.issues.map((issue) => issue.code)).toContain(
      "freeze_digest_mismatch",
    );
    expect(
      authorizeSimplifiedChineseBlindCorpusUse(
        {
          ...manifest,
          freeze: {
            ...manifest.freeze,
            manifestDigest: "f".repeat(64),
          },
        },
        "final_tuple_evaluation",
      ),
    ).toMatchObject({ allowed: false });
  });

  it("requires concrete repository revision and upstream harness evidence", () => {
    const manifest = completeManifest();
    const report = validateSimplifiedChineseBlindCorpus({
      ...manifest,
      freeze: {
        ...manifest.freeze,
        sourceRevision: "fixture-revision",
      },
      upstreamHarness: {
        ...manifest.upstreamHarness,
        evidenceRef: null,
      },
    });

    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "freeze_source_revision_invalid",
        "upstream_harness_evidence_missing",
      ]),
    );
  });
});
