import "server-only";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { boundContext, HEADING_LIMIT, normalizePassage, type TranslationRequest } from "./contract";

type MarkdownNode = {
  type: string;
  tagName?: string;
  value?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number } };
};

function nodeText(node: MarkdownNode): string {
  if (node.type === "text" || node.type === "raw") return node.value ?? "";
  if (node.tagName === "br") return " ";
  return (node.children ?? []).map(nodeText).join("");
}

/** Uses the same Markdown/GFM parse as the reading surface, preserving source
 * positions even when emphasis, links, entities, or tight lists alter the DOM. */
export function verifyTranslationPassage(markdown: string, input: TranslationRequest): { text: string; context: string; heading: string } | null {
  let heading = "";
  let match: { text: string; context: string; heading: string } | null = null;
  function capturePassages() {
    return (tree: unknown) => {
      function visit(node: MarkdownNode) {
        const isHeading = /^h[1-6]$/.test(node.tagName ?? "");
        if (isHeading) {
          heading = Array.from(normalizePassage(nodeText(node))).slice(0, HEADING_LIMIT).join("");
        }
        const translatable = isHeading || node.tagName === "p" ||
          (node.tagName === "li" && !(node.children ?? []).some(child => ["p", "ul", "ol"].includes(child.tagName ?? "")));
        if (translatable && node.position?.start.offset === input.blockStart) {
          const text = normalizePassage(nodeText(node));
          const context = boundContext(text, input.selectionStart);
          if (text.slice(input.selectionStart, input.selectionStart + input.text.length) === input.text &&
              context === input.context && heading === input.heading) {
            match = { text: input.text, context, heading };
          }
        }
        for (const child of node.children ?? []) visit(child);
      }
      visit(tree as MarkdownNode);
    };
  }
  Markdown({ children: markdown, remarkPlugins: [remarkGfm], rehypePlugins: [capturePassages] });
  return match;
}
