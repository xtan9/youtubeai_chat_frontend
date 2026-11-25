import { replaceDraftRange, type Draft } from "./contract";

type Outline = NonNullable<Draft["outline"]>;
export type StoryBeat = Outline["sections"][number];

export function reviseOutline(
  draft: Draft,
  sections: StoryBeat[],
  angle: string,
  interviewId: string,
): Draft {
  const kept = new Set(sections.map((s) => s.id).filter(Boolean));
  const removed = [
    ...(draft.outline?.removed ?? []),
    ...(draft.outline?.sections ?? []),
  ].filter((s) => s.bodyStart !== undefined && (!s.id || !kept.has(s.id)));
  if (removed.length > 300) throw Error("capacity");
  return orderWrittenSections(
    { ...draft, version: crypto.randomUUID() },
    {
      interviewId,
      angle,
      sections,
      ...(removed.length ? { removed } : {}),
    },
  );
}

type Slice = { start: number; end: number; dest: number };

// Preserve the unlinked opening and the paragraph separators at each position.
// All other characters and their formats travel with the written section.
function orderWrittenSections(draft: Draft, outline: Outline): Draft {
  const ordered = [...outline.sections, ...(outline.removed ?? [])].filter(
    (s) => s.bodyStart !== undefined,
  );
  const physical = [...ordered].sort((a, b) => a.bodyStart! - b.bodyStart!);
  if (physical.every((s, i) => s === ordered[i])) return { ...draft, outline };

  const slices: Slice[] = [];
  let length = 0;
  function take(start: number, end: number) {
    if (end <= start) return;
    slices.push({ start, end, dest: length });
    length += end - start;
  }
  const blocks = new Map(
    physical.map((beat, i) => {
      const start = beat.bodyStart!,
        end = physical[i + 1]?.bodyStart ?? draft.text.length;
      const separator = draft.text.slice(start, end).match(/\n*$/)![0].length;
      return [beat, { start, contentEnd: end - separator, end }];
    }),
  );
  take(0, physical[0].bodyStart!);
  const positions = new Map<StoryBeat, number>();
  ordered.forEach((beat, i) => {
    const source = blocks.get(beat)!,
      slot = blocks.get(physical[i])!;
    positions.set(beat, length);
    take(source.start, source.contentEnd);
    take(slot.contentEnd, slot.end);
  });
  // Keep the formatting of the editor's implicit final newline, too.
  take(draft.text.length, draft.text.length + 1);
  const text = slices.map((s) => draft.text.slice(s.start, s.end)).join("");
  const formatting = slices.flatMap((s) =>
    (draft.formatting ?? []).flatMap((r) => {
      const start = Math.max(s.start, r.start),
        end = Math.min(s.end, r.start + r.length);
      return end > start
        ? [{ ...r, start: s.dest + start - s.start, length: end - start }]
        : [];
    }),
  );
  const markers = draft.markers.flatMap((m) => {
    const slice = slices.find((s) => s.start <= m.start && s.end > m.start);
    if (!slice) return [];
    const start = slice.dest + m.start - slice.start;
    return text.slice(start, start + m.text.length) === m.text
      ? [{ ...m, start }]
      : [];
  });
  const move = (s: StoryBeat) =>
    positions.has(s) ? { ...s, bodyStart: positions.get(s) } : s;
  return {
    ...draft,
    text,
    markers,
    formatting: formatting.length ? formatting : undefined,
    outline: {
      ...outline,
      sections: outline.sections.map(move),
      removed: outline.removed?.map(move),
    },
  };
}

type Script = {
  lead: string;
  sections: { heading: string; body: string }[];
  markers?: Draft["markers"];
};

// The canonical rich-text document owns prose, formatting and citations. Outline
// edits move references only. New prose enters through the same range-edit path.
export function writeOutlineBody(
  draft: Draft,
  section?: number,
  script?: Script,
): Draft {
  const outline = draft.outline;
  if (!outline) throw Error("interviewChanged");
  const targets =
    section === undefined
      ? outline.sections
      : outline.sections.slice(section, section + 1);
  if (
    !targets.length ||
    targets.some((s) => s.bodyStart !== undefined) ||
    (section === undefined && draft.text.trim()) ||
    (script && script.sections.length !== targets.length)
  )
    throw Error("interviewChanged");
  const start =
    section === undefined
      ? draft.text.length
      : (outline.sections
          .slice(section + 1)
          .find((s) => s.bodyStart !== undefined)?.bodyStart ??
        draft.text.length);
  const before = draft.text.slice(0, start),
    after = draft.text.slice(start);
  const prefix = before && !before.endsWith("\n\n") ? "\n\n" : "";
  const suffix = after ? "\n\n" : "";
  let insert = script?.lead ?? "";
  const positions = new Map<StoryBeat, number>();
  targets.forEach((beat, i) => {
    if (insert) insert += "\n\n";
    positions.set(beat, start + prefix.length + (i === 0 ? 0 : insert.length));
    insert +=
      "## " +
      (script?.sections[i].heading ?? beat.heading) +
      "\n" +
      (script?.sections[i].body ?? "");
  });
  const text = before + prefix + insert + suffix + after;
  const citations = script?.markers ?? [];
  if (text.length > 80000 || draft.markers.length + citations.length > 300)
    throw Error("capacity");
  const next = replaceDraftRange(
    draft,
    text,
    start,
    start,
    start + prefix.length + insert.length + suffix.length,
  );
  return {
    ...next,
    markers: [
      ...next.markers,
      ...citations.map((m) => ({
        ...m,
        start: start + prefix.length + m.start,
      })),
    ],
    outline: {
      ...next.outline!,
      sections: next.outline!.sections.map((beat, i) => {
        const pos = positions.get(outline.sections[i]);
        return pos === undefined
          ? beat
          : { ...beat, id: beat.id ?? crypto.randomUUID(), bodyStart: pos };
      }),
    },
  };
}
