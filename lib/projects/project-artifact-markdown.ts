import type { ProjectAnswerSourceManifest } from "./project-grounded-answer-contract";
import { parseProjectCitations } from "./project-grounded-citations";

const MARKDOWN_INLINE_LINK = /!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/gu;
const MARKDOWN_REFERENCE_LINK = /\[([^\]]+)\]\[[^\]]*\]/gu;
const MARKDOWN_REFERENCE_DEFINITION = /^\s*\[[^\]]+\]:\s*\S+.*$/gmu;
const MARKDOWN_AUTOLINK = /<\s*(?:https?|javascript|data|vbscript|file):[^>]*>/giu;
const MARKDOWN_RAW_HTML = /<\/?[A-Za-z][^>]*>/gu;
const UNSAFE_OR_EXTERNAL_SCHEME =
  /\b(?:https?|javascript|data|vbscript|file):[^\s<]+/giu;

/**
 * Model prose is untrusted Markdown. Preserve its readable label/prose while
 * removing every author-supplied link target; canonical timestamp links are
 * added later from the validated Source Manifest.
 */
export function sanitizeProjectArtifactMarkdown(rawContent: string) {
  return rawContent
    .replace(MARKDOWN_INLINE_LINK, "$1")
    .replace(MARKDOWN_REFERENCE_LINK, "$1")
    .replace(MARKDOWN_REFERENCE_DEFINITION, "")
    .replace(MARKDOWN_AUTOLINK, "[link removed]")
    .replace(MARKDOWN_RAW_HTML, "")
    .replace(UNSAFE_OR_EXTERNAL_SCHEME, "[link removed]");
}

export function buildProjectArtifactMarkdown(
  content: string,
  sourceManifest: ProjectAnswerSourceManifest,
) {
  return parseProjectCitations(
    sanitizeProjectArtifactMarkdown(content),
    sourceManifest,
  )
    .map((part) =>
      part.type === "text"
        ? part.value
        : `[${part.raw.slice(1, -1)}](${part.href})`,
    )
    .join("");
}
