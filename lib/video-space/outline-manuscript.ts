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
  return {
    ...draft,
    version: crypto.randomUUID(),
    outline: {
      interviewId,
      angle,
      sections,
      ...(removed.length ? { removed } : {}),
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
        return pos === undefined ? beat : { ...beat, bodyStart: pos };
      }),
    },
  };
}
