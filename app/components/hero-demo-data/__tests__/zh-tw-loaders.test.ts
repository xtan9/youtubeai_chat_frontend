import { describe, it, expect } from "vitest";
import { SAMPLES } from "..";

// The 6 zh-TW.ts files in this PR are placeholders cloned from zh.ts —
// type system can't catch a copy-paste regression that leaves
// `language: "zh"` while the file lives at the zh-TW.ts path. These
// runtime asserts pin the (id, language) round-trip so any future regen
// or hand-edit that breaks the contract surfaces here.
//
// Script-correctness of the `summary` text is verified out-of-band by
// the follow-up data-only PR (see TODO(zh-tw-data) in each file).
describe("hero-demo zh-TW loaders", () => {
  for (const sample of SAMPLES) {
    it(`${sample.id}: loadSummary("zh-TW") returns the matching id and language`, async () => {
      const payload = await sample.loadSummary("zh-TW");
      expect(payload.id).toBe(sample.id);
      expect(payload.language).toBe("zh-TW");
    });
  }
});
