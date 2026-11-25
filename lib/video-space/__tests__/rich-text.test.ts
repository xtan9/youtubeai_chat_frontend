import { describe, expect, it } from "vitest";
import Delta from "quill-delta";
import { editDraft, emptySpace, replaceDraftRange, spaceSchema, type Draft } from "../contract";
import { draftContents, editorContents, moveEditorMarkers } from "../rich-text";

const citation = { material: { id: "book", title: "Source", location: "p. 3", quote: "引文" }, text: "引文" };

describe("rich manuscript persistence", () => {
  it("round trips legacy headings, empty lines and a terminal newline", () => {
    for (const text of ["", "\n", "旧稿🙂\n\n## 二级标题\n\n", "# ", "### 结尾"]) {
      expect(draftContents(editorContents({ text }))).toMatchObject({ text, formatting: [] });
    }
  });

  it("saves independent inline, block and last-cell styles using source offsets", () => {
    const delta = new Delta().insert("标题").insert("\n", { header: 2 }).insert("🙂", { bold: true })
      .insert("链接", { link: "https://example.org" }).insert("\n", { list: "bullet", indent: 1 })
      .insert("单元格").insert("\n", { table: "row-a" });
    const { text, formatting, sourceIndex, editorIndex } = draftContents(delta);
    expect(text).toBe("## 标题\n🙂链接\n单元格");
    expect(text.slice(sourceIndex(3), sourceIndex(5, true))).toBe("🙂");
    expect(editorIndex(text.indexOf("链接"))).toBe(5);
    const space = emptySpace();
    space.drafts[0] = { ...space.drafts[0], text, formatting };
    expect(editorContents(spaceSchema.parse(space).drafts[0]).ops).toEqual(delta.ops);
  });

  it("distinguishes a typed literal heading prefix from a real heading", () => {
    const delta = new Delta().insert("## Plain\n").insert("Heading").insert("\n", { header: 2 });
    const doc = draftContents(delta);
    expect(editorContents(doc).ops).toEqual(delta.ops);
    expect(doc.sourceIndex(9, true)).toBe(9);
    expect(doc.sourceIndex(9)).toBe(12);
  });

  it("keeps surrounding emphasis and references across a targeted assistant edit or evidence insertion", () => {
    const contents = new Delta().insert("前文", { italic: true }).insert("改写").insert("引文", { bold: true }).insert("\n");
    const { text, formatting } = draftContents(contents);
    const draft: Draft = { ...emptySpace().drafts[0], text, formatting, markers: [{ ...citation, start: 4 }] };
    const replacement = replaceDraftRange(draft, "前文新内容引文", 2, 4, 5);
    expect(replacement.markers[0].start).toBe(5);
    expect(editorContents(replacement).ops).toEqual(new Delta().insert("前文", { italic: true })
      .insert("新内容").insert("引文", { bold: true }).insert("\n").ops);
    const append = editDraft(replacement, replacement.text + "\n来源");
    expect(append.markers).toEqual(replacement.markers);
    expect(append.formatting).toEqual(replacement.formatting);
    expect(editDraft(append, "前文新内容改动\n来源").markers).toEqual([]);
  });

  it("tracks citations between headings and distinguishes identical quoted sentences", () => {
    const plain = new Delta().insert("甲\n引文\n乙\n引文\n");
    const change = new Delta().retain(1).retain(1, { header: 2 }).retain(4).retain(1, { header: 2 });
    const before = draftContents(plain), after = draftContents(plain.compose(change));
    expect(moveEditorMarkers([{ ...citation, start: 2 }, { ...citation, start: 7 }], before, after, change))
      .toEqual([{ ...citation, start: 5 }, { ...citation, start: 13 }]);
  });
});
