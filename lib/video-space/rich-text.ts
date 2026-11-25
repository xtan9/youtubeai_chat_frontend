import Delta, { type AttributeMap } from "quill-delta";
import type { Draft, FormatRange } from "./contract";

const heading = /^(#{1,6}) /;
export const editorFormats = [
  "header", "bold", "italic", "underline", "strike", "code", "blockquote", "font",
  "size", "color", "background", "align", "indent", "list", "link", "table",
];

export function editorContents(draft: Pick<Draft, "text" | "formatting">) {
  const source = draft.text + "\n";
  const formatted = new Delta();
  let offset = 0;
  for (const range of draft.formatting ?? []) {
    formatted.insert(source.slice(offset, range.start));
    offset = range.start + range.length;
    formatted.insert(source.slice(range.start, offset), range.attributes);
  }
  formatted.insert(source.slice(offset));
  const contents = new Delta();
  formatted.eachLine((line, attributes) => {
    const { literalHeading, ...block } = attributes;
    // Inline styles can split the first few characters across multiple ops.
    const prefix = !literalHeading && heading.exec(line.slice(0, 7).map(op => op.insert).join(""));
    if (prefix) block.header = prefix[1].length;
    for (const op of (prefix ? line.slice(prefix[0].length) : line).ops) contents.push(op);
    contents.insert("\n", block);
  });
  return contents;
}

function normalizeAttributes(input: AttributeMap): FormatRange["attributes"] {
  const attributes = { ...input };
  delete attributes.header;
  for (const name of ["background", "color"]) {
    if (attributes[name] && !/^#[0-9a-f]{6}$/i.test(String(attributes[name]))) delete attributes[name];
  }
  if (attributes.link && (typeof attributes.link !== "string" || attributes.link.length > 3000 ||
    !URL.canParse(attributes.link) || !["http:", "https:", "tel:", "mailto:"].includes(new URL(attributes.link).protocol))) delete attributes.link;
  if (attributes.table && !/^[a-zA-Z0-9_-]{1,80}$/.test(String(attributes.table))) delete attributes.table;
  return attributes;
}

export function draftContents(contents: Delta) {
  let text = "", editorStart = 0;
  const formatting: FormatRange[] = [];
  const prefixes: { index: number; length: number }[] = [];
  function append(value: string, attrs?: AttributeMap) {
    if (attrs && value.length) {
      const attributes = normalizeAttributes(attrs);
      if (Object.keys(attributes).length) formatting.push({ start: text.length, length: value.length, attributes });
    }
    text += value;
  }
  contents.eachLine((line, attributes) => {
    const prefix = attributes.header ? "#".repeat(Number(attributes.header)) + " " : "";
    if (prefix) prefixes.push({ index: editorStart, length: prefix.length });
    append(prefix);
    for (const op of line.ops) if (typeof op.insert === "string") append(op.insert, op.attributes);
    const literal = !prefix && heading.test(line.slice(0, 7).map(op => op.insert).join(""));
    append("\n", literal ? { ...attributes, literalHeading: true } : attributes);
    editorStart += line.length() + 1;
  });
  return {
    text: text.slice(0, -1),
    formatting,
    editorIndex(source: number) {
      let index = source;
      for (const prefix of prefixes) {
        if (index <= prefix.index) break;
        index = Math.max(prefix.index, index - prefix.length);
      }
      return index;
    },
    sourceIndex(index: number, end = false) {
      let offset = index;
      for (const prefix of prefixes) {
        if (prefix.index > index || (end && prefix.index === index)) break;
        offset += prefix.length;
      }
      return offset;
    },
  };
}


// Formatting multiple headings changes several Markdown prefixes in one edit.
// Follow Quill's actual retained characters so intervening citations stay attached.
export function moveEditorMarkers(markers: Draft["markers"], before: ReturnType<typeof draftContents>,
  after: ReturnType<typeof draftContents>, change: Delta) {
  return markers.flatMap(marker => {
    const from = before.editorIndex(marker.start);
    const to = before.editorIndex(marker.start + marker.text.length);
    const start = after.sourceIndex(change.transformPosition(from));
    const end = after.sourceIndex(change.transformPosition(to, true), true);
    return after.text.slice(start, end) === marker.text ? [{ ...marker, start }] : [];
  });
}
