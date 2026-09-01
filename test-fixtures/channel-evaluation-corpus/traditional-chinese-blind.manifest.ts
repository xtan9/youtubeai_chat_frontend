import { createTraditionalChineseBlindEvaluationCorpus } from "../../lib/channel/traditional-chinese-evaluation-corpus-governance";

/**
 * Repository-side manifest entrypoint for the Traditional Chinese slice.
 *
 * The factory intentionally materializes synthetic records only. Human review,
 * approval, freeze, and upstream harness evidence remain explicit fields in
 * the returned manifest and are not inferred here.
 */
export const TRADITIONAL_CHINESE_BLIND_MANIFEST =
  createTraditionalChineseBlindEvaluationCorpus();

export default TRADITIONAL_CHINESE_BLIND_MANIFEST;
