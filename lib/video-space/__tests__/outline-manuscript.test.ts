import { expect, it } from "vitest";
import { editDraft, spaceSchema, type Draft } from "../contract";
import { reviseOutline, writeOutlineBody } from "../outline-manuscript";

it("keeps cited, formatted prose attached through manual outline edits, removal and restoration", () => {
  const finding = crypto.randomUUID();
  const legacy: Draft = {
    id: "plan",
    title: "Kitchen oils",
    text: "",
    markers: [],
    outline: {
      interviewId: crypto.randomUUID(),
      sections: [
        { heading: "A", questionIds: [] },
        { heading: "B", questionIds: [] },
      ],
    },
  };
  const beats = legacy.outline!.sections.map((s) => ({
    ...s,
    id: crypto.randomUUID(),
  }));
  let draft = reviseOutline(
    legacy,
    beats,
    "Compare the oils",
    legacy.outline!.interviewId,
  );
  const scripted = writeOutlineBody(draft, 1, {
    lead: "Second.",
    sections: [{ heading: "B", body: "Cited." }],
    markers: [{ start: 14, text: "Cited.", finding }],
  });
  draft = editDraft(scripted, scripted.text, [
    { start: 0, length: 6, attributes: { bold: true } },
  ]);
  draft = writeOutlineBody(draft, 0);
  expect(draft.text).toBe("## A\n\n\nSecond.\n\n## B\nCited.");
  expect(draft.text.slice(draft.markers[0].start)).toBe("Cited.");
  expect(draft.formatting?.[0]).toMatchObject({ start: 7, length: 6 });
  const [a, b] = draft.outline!.sections;
  const removed = reviseOutline(
    draft,
    [{ ...a, heading: "New opening" }],
    "",
    legacy.outline!.interviewId,
  );
  expect(removed.outline!.removed).toEqual([b]);
  expect(removed.text).toBe(draft.text);
  expect(removed.text.slice(b.bodyStart!)).toMatch(/^Second\./);
  const restored = reviseOutline(
    removed,
    [b, a],
    "",
    legacy.outline!.interviewId,
  );
  expect(restored.outline?.removed).toBeUndefined();
  expect(restored.text).toBe("Second.\n\n## B\nCited.\n\n\n## A");
  expect(
    restored.text.slice(
      restored.markers[0].start,
      restored.markers[0].start + 6,
    ),
  ).toBe("Cited.");
  expect(restored.formatting?.[0]).toMatchObject({ start: 0, length: 6 });
  const deleted = editDraft(restored, "## A");
  expect(deleted.outline?.sections[0].bodyStart).toBeUndefined();
  expect(deleted.outline?.sections[1].bodyStart).toBe(0);
  expect(
    spaceSchema.parse({ drafts: [restored], resources: [], messages: [] })
      .drafts[0].outline,
  ).toEqual(restored.outline);
  expect(() => writeOutlineBody(restored, 0)).toThrow();
});

it("moves the last paragraph's newline formatting and inserts new prose before archived prose", () => {
  const a = {
    id: crypto.randomUUID(),
    heading: "A",
    questionIds: [],
    bodyStart: 0,
  };
  const b = {
    id: crypto.randomUUID(),
    heading: "B",
    questionIds: [],
    bodyStart: 7,
  };
  const interviewId = crypto.randomUUID();
  const draft: Draft = {
    id: "video",
    title: "A and B",
    text: "Quote\n\nPlain",
    markers: [],
    formatting: [{ start: 5, length: 1, attributes: { blockquote: true } }],
    outline: { interviewId, sections: [a, b] },
  };
  const moved = reviseOutline(draft, [b, a], "", interviewId);
  expect(moved.text).toBe("Plain\n\nQuote");
  expect(moved.formatting).toEqual([
    { start: 12, length: 1, attributes: { blockquote: true } },
  ]);
  const next = { id: crypto.randomUUID(), heading: "C", questionIds: [] };
  const archived = reviseOutline(draft, [next], "", interviewId);
  const written = writeOutlineBody(archived, 0);
  expect(written.text).toBe("## C\n\n\nQuote\n\nPlain");
  expect(written.outline?.removed?.[0].bodyStart).toBe(7);
});
