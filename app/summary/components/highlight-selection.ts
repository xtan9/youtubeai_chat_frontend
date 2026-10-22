import { boundContext, HEADING_LIMIT, isSingleSentence, normalizePassage } from "@/lib/highlight-translation/contract";

export type PassageSelection = {
  range: Range;
  passage: { text: string; context: string; heading: string; blockStart: number; selectionStart: number } | null;
};

export function readPassageSelection(root: HTMLElement): PassageSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const elementFor = (node: Node) => node instanceof Element ? node : node.parentElement;
  const start = elementFor(range.startContainer);
  const end = elementFor(range.endContainer);
  if (start?.closest("button,input,textarea,select,pre") || end?.closest("button,input,textarea,select,pre")) return null;
  const block = start?.closest<HTMLElement>("[data-translation-block]");
  const endBlock = end?.closest("[data-translation-block]");
  const invalid = { range: range.cloneRange(), passage: null };
  if (!block || block !== endBlock || !root.contains(block)) return invalid;
  // Tight list items may contain another list; those are not one paragraph.
  if (block.tagName === "LI" && block.querySelector("p,ul,ol")) return invalid;
  const raw = range.toString();
  const text = normalizePassage(raw);
  if (!isSingleSentence(text)) return invalid;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(block);
  prefix.setEnd(range.startContainer, range.startOffset);
  const leading = raw.match(/^\s*/u)?.[0] ?? "";
  const selectionStart = (prefix.toString() + leading).replace(/\s+/gu, " ").trimStart().length;
  const paragraph = normalizePassage(block.textContent ?? "");
  if (paragraph.slice(selectionStart, selectionStart + text.length) !== text) return invalid;
  const blockStart = Number(block.dataset.translationBlock);
  if (!Number.isInteger(blockStart) || blockStart < 0) return invalid;
  let heading = "";
  for (const node of root.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    if (node === block || (node.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      heading = Array.from(normalizePassage(node.textContent ?? "")).slice(0, HEADING_LIMIT).join("");
    }
  }
  return { range: range.cloneRange(), passage: { text, selectionStart, blockStart, context: boundContext(paragraph, selectionStart), heading } };
}

export function positionTranslation(range: Range, root: HTMLElement, height: number) {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const rect = range.getBoundingClientRect();
  const bounds = root.getBoundingClientRect();
  const top = Math.max(0, bounds.top);
  const bottom = Math.min(window.innerHeight, bounds.bottom);
  if (rect.bottom <= top || rect.top >= bottom || rect.right <= 0 || rect.left >= window.innerWidth) return null;
  const width = Math.min(400, window.innerWidth - 24);
  const below = window.innerHeight - rect.bottom - 20;
  const above = rect.top - 20;
  const useBelow = below >= Math.min(height, 300) || below >= above;
  const maxHeight = Math.max(0, useBelow ? below : above);
  if (maxHeight < 40) return null;
  return {
    width, maxHeight,
    left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
    top: useBelow ? rect.bottom + 8 : Math.max(12, rect.top - Math.min(height, maxHeight) - 8),
  };
}
