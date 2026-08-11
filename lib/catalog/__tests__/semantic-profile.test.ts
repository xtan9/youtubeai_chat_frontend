import { describe, expect, it, vi } from "vitest";

const { callLlmJson } = vi.hoisted(() => ({ callLlmJson: vi.fn() }));

vi.mock("@/lib/services/llm-client", () => ({ callLlmJson }));

import {
  generateSemanticProfile,
  parseSemanticProfile,
} from "../semantic-profile";

const VALID_PROFILE = {
  schemaVersion: "semantic-profile-v1",
  sourceLanguage: "zh-CN",
  topics: [
    { key: "machine-learning", label: "Machine learning" },
  ],
  coreConcepts: [
    { key: "gradient-descent", label: "Gradient descent" },
    { key: "neural-network", label: "Neural network" },
  ],
  difficulty: "intermediate",
  prerequisiteConceptKeys: ["linear-algebra"],
  applicationConceptKeys: ["image-classification"],
  counterpointConceptKeys: ["symbolic-ai"],
} as const;

describe("parseSemanticProfile", () => {
  it("accepts the governed profile and canonicalizes deterministic ordering", () => {
    const parsed = parseSemanticProfile(
      JSON.stringify({
        ...VALID_PROFILE,
        topics: [
          { key: "statistics", label: "Statistics" },
          { key: "machine-learning", label: "Machine learning" },
        ],
        coreConcepts: [...VALID_PROFILE.coreConcepts].reverse(),
        prerequisiteConceptKeys: ["probability", "linear-algebra"],
      }),
    );

    expect(parsed.topics.map((item) => item.key)).toEqual([
      "machine-learning",
      "statistics",
    ]);
    expect(parsed.coreConcepts.map((item) => item.key)).toEqual([
      "gradient-descent",
      "neural-network",
    ]);
    expect(parsed.prerequisiteConceptKeys).toEqual([
      "linear-algebra",
      "probability",
    ]);
  });

  it("rejects prose, unknown fields, duplicate keys, and noncanonical concept keys", () => {
    expect(() => parseSemanticProfile("Here is the profile: {}"))
      .toThrow(/valid JSON/);
    expect(() =>
      parseSemanticProfile(JSON.stringify({ ...VALID_PROFILE, confidence: 0.9 })),
    ).toThrow(/schema/);
    expect(() =>
      parseSemanticProfile(
        JSON.stringify({
          ...VALID_PROFILE,
          applicationConceptKeys: ["image-classification", "image-classification"],
        }),
      ),
    ).toThrow(/schema/);
    expect(() =>
      parseSemanticProfile(
        JSON.stringify({
          ...VALID_PROFILE,
          coreConcepts: [
            { key: "Gradient Descent", label: "Gradient descent" },
            VALID_PROFILE.coreConcepts[1],
          ],
        }),
      ),
    ).toThrow(/schema/);
  });
});

describe("generateSemanticProfile", () => {
  it("uses the existing backend gateway with bounded native evidence and validates the result", async () => {
    callLlmJson.mockResolvedValue(JSON.stringify(VALID_PROFILE));

    const profile = await generateSemanticProfile({
      title: "神经网络入门",
      sourceLanguage: "zh-CN",
      transcript: "独特的中文转录内容。".repeat(4_000),
      signal: new AbortController().signal,
    });

    expect(profile).toEqual(VALID_PROFILE);
    expect(callLlmJson).toHaveBeenCalledOnce();
    expect(callLlmJson).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 30_000,
        signal: expect.any(AbortSignal),
      }),
    );
    const prompt = callLlmJson.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("神经网络入门");
    expect(prompt).toContain("独特的中文转录内容");
    expect(prompt.length).toBeLessThan(40_000);
    expect(prompt).toContain("Return exactly one JSON object");
  });

  it("uses the shared backend model configuration", async () => {
    vi.stubEnv("LLM_MODEL", "shared-gateway-model");
    callLlmJson.mockResolvedValue(JSON.stringify(VALID_PROFILE));

    try {
      await generateSemanticProfile({
        title: "Gradient descent",
        sourceLanguage: "en",
        transcript: "A bounded transcript.",
        signal: new AbortController().signal,
      });
      expect(callLlmJson).toHaveBeenCalledWith(
        expect.objectContaining({ model: "shared-gateway-model" }),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
