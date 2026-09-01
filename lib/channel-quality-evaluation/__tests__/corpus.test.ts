import { describe, expect, it } from "vitest";

import {
  CHANNEL_QUALITY_SUPPORTED_LANGUAGES,
  createChannelQualityCorpusItem,
  freezeChannelQualityCorpus,
  validateChannelQualityCorpus,
  validateChannelQualityCorpora,
  validateChannelQualityTuningCorpus,
  verifyChannelQualityCorpusFingerprint,
  type ChannelQualityCorpusItemDraft,
  type ChannelQualityCorpusManifestDraft,
  type ChannelQualityLanguage,
} from "../index";

const REVIEWERS = {
  protocol: "two_independent_reviewers_third_resolves_disagreement" as const,
  reviewers: [
    {
      id: "reviewer-primary",
      role: "primary" as const,
      reviewedAt: "2026-08-31T12:00:00.000Z",
    },
    {
      id: "reviewer-secondary",
      role: "secondary" as const,
      reviewedAt: "2026-08-31T12:01:00.000Z",
    },
    {
      id: "reviewer-adjudicator",
      role: "adjudicator" as const,
      reviewedAt: "2026-08-31T12:02:00.000Z",
    },
  ],
};

function item(
  overrides: Partial<ChannelQualityCorpusItemDraft> = {},
): ReturnType<typeof createChannelQualityCorpusItem> {
  const language = (overrides.language ?? "english") as ChannelQualityLanguage;
  const base = {
    id: overrides.id ?? `item-${language}`,
    kind: overrides.kind ?? "classification",
    language,
    expectedClassification:
      overrides.expectedClassification ?? "allowed_criticism",
    expectedValidatorCategory: overrides.expectedValidatorCategory ?? null,
    crossCuts: overrides.crossCuts ?? [],
    input: overrides.input ?? {
      commentText: "The explanation could include more detail.",
      videoTitle: "A synthetic educational video",
    },
    codeSwitchEvidence:
      overrides.codeSwitchEvidence !== undefined
        ? overrides.codeSwitchEvidence
        : language === "chinese_english_code_switch"
          ? {
              englishClause: "This explanation needs more detail",
              chineseClause: "这个解释需要更多细节",
              independentlyMeaningful: true,
              reviewedBy: "reviewer-primary",
            }
          : null,
  } satisfies ChannelQualityCorpusItemDraft;

  return createChannelQualityCorpusItem(base);
}

function corpus(
  split: "development" | "blind",
  items: readonly ReturnType<typeof item>[],
): ReturnType<typeof freezeChannelQualityCorpus> {
  const draft: ChannelQualityCorpusManifestDraft = {
    manifestVersion: "channel-quality-corpus-manifest-v1",
    corpusVersion: "channel-comment-assistance-v1",
    split,
    frozenAt: "2026-08-31T12:00:00.000Z",
    policyVersion: "youtube-community-guidelines-2026-08-31",
    dataGovernance: "synthetic",
    reviewers: REVIEWERS,
    items,
  };
  return freezeChannelQualityCorpus(draft);
}

describe("Channel quality corpus manifests", () => {
  it("freezes inputs with per-item and manifest fingerprints", () => {
    const frozen = corpus("development", [item()]);

    expect(frozen.state).toBe("frozen");
    expect(frozen.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(frozen.items[0]?.inputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyChannelQualityCorpusFingerprint(frozen)).toBe(true);
    expect(
      validateChannelQualityCorpus(frozen, {
        expectedSplit: "development",
        requireReleaseMinimums: false,
      }),
    ).toMatchObject({ ok: true });

    const tampered = {
      ...frozen,
      items: [
        {
          ...frozen.items[0]!,
          input: {
            ...frozen.items[0]!.input,
            commentText: "A changed input must not reuse the old manifest.",
          },
        },
      ],
    };

    const validation = validateChannelQualityCorpus(tampered, {
      expectedSplit: "development",
      requireReleaseMinimums: false,
    });
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining(["input_hash_mismatch", "manifest_hash_mismatch"]),
      );
    }
  });

  it("fingerprints normalized schema values", () => {
    const normalized = item({
      id: "  normalized-item  ",
      input: {
        commentText: "  A bounded comment.  ",
        videoTitle: "  A bounded video  ",
      },
    });

    expect(normalized.id).toBe("normalized-item");
    expect(normalized.input.commentText).toBe("A bounded comment.");
    expect(
      validateChannelQualityCorpus(corpus("development", [normalized]), {
        expectedSplit: "development",
        requireReleaseMinimums: false,
      }),
    ).toMatchObject({ ok: true });
  });

  it("requires code-switch evidence and independent reviewer provenance", () => {
    const invalid = corpus("blind", [
      item({
        id: "code-switch-without-evidence",
        language: "chinese_english_code_switch",
        codeSwitchEvidence: null,
      }),
    ]);

    const validation = validateChannelQualityCorpus(invalid, {
      expectedSplit: "blind",
      requireReleaseMinimums: false,
    });
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining(["code_switch_ineligible"]),
      );
    }

    const badReviewers = corpus("development", [item()]);
    const malformed = {
      ...badReviewers,
      reviewers: {
        ...badReviewers.reviewers,
        reviewers: [
          badReviewers.reviewers.reviewers[0]!,
          {
            ...badReviewers.reviewers.reviewers[0]!,
            id: "reviewer-secondary-copy",
          },
          badReviewers.reviewers.reviewers[2]!,
        ],
      },
    };
    const reviewerValidation = validateChannelQualityCorpus(malformed, {
      expectedSplit: "development",
      requireReleaseMinimums: false,
    });
    expect(reviewerValidation.ok).toBe(false);
    if (!reviewerValidation.ok) {
      expect(reviewerValidation.issues.map((issue) => issue.code)).toContain(
        "reviewer_provenance",
      );
    }
  });

  it("keeps development and blind corpora disjoint", () => {
    const development = corpus("development", [
      item({ id: "development-item" }),
    ]);
    const blind = corpus("blind", [
      item({ id: "blind-item", input: development.items[0]!.input }),
    ]);

    const validation = validateChannelQualityCorpora({
      development,
      blind,
      requireReleaseMinimums: false,
    });
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.issues.map((issue) => issue.code)).toContain(
        "corpus_overlap",
      );
    }
  });

  it("rejects every frozen blind manifest at the tuning seam", () => {
    const blind = corpus("blind", [item({ id: "blind-only-item" })]);

    const validation = validateChannelQualityTuningCorpus(blind);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.issues.map((issue) => issue.code)).toContain(
        "blind_corpus_not_tunable",
      );
    }

    const development = corpus("development", [
      item({ id: "development-only-item" }),
    ]);
    expect(validateChannelQualityTuningCorpus(development)).toMatchObject({
      ok: true,
    });
  });

  it("checks the approved blind composition before any model result is evaluated", () => {
    const blind = corpus("blind", [item({ id: "one-blind-item" })]);
    const validation = validateChannelQualityCorpus(blind, {
      expectedSplit: "blind",
      requireReleaseMinimums: true,
    });

    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining([
          "minimum_sample_count",
          "cross_cut_minimum",
        ]),
      );
    }
  });

  it("defines the four approved supported language slices", () => {
    expect(CHANNEL_QUALITY_SUPPORTED_LANGUAGES).toEqual([
      "english",
      "simplified_chinese",
      "traditional_chinese",
      "chinese_english_code_switch",
    ]);
  });
});
