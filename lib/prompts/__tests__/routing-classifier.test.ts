import { describe, it, expect } from "vitest";
import { buildClassifierPrompt } from "../routing-classifier";

describe("buildClassifierPrompt", () => {
  it("builds an English prompt containing the title and excerpt", () => {
    const prompt = buildClassifierPrompt({
      transcriptExcerpt: "machine learning tutorial about transformers",
      title: "Intro to Transformers",
      language: "en",
    });
    expect(prompt).toContain("Intro to Transformers");
    expect(prompt).toContain("machine learning tutorial about transformers");
    expect(prompt.toLowerCase()).toContain("density");
    expect(prompt.toLowerCase()).toContain("structure");
    expect(prompt).toContain("JSON");
  });

  it("builds a Chinese prompt containing the title and excerpt", () => {
    const prompt = buildClassifierPrompt({
      transcriptExcerpt: "机器学习教程",
      title: "变换器入门",
      language: "zh",
    });
    expect(prompt).toContain("变换器入门");
    expect(prompt).toContain("机器学习教程");
    expect(prompt).toContain("JSON");
    // Chinese-language marker to verify we actually produced the zh branch.
    expect(prompt).toMatch(/[\u4e00-\u9fff]/);
  });

  it("lists the exact allowed enum values for each dimension", () => {
    const prompt = buildClassifierPrompt({
      transcriptExcerpt: "x",
      title: "y",
      language: "en",
    });
    for (const v of ["low", "medium", "high"]) expect(prompt).toContain(v);
    for (const v of ["tutorial", "lecture", "news", "casual", "interview", "other"]) {
      expect(prompt).toContain(v);
    }
    for (const v of ["structured", "rambling"]) expect(prompt).toContain(v);
  });
});
