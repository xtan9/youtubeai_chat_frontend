import type {
  ProjectAnswerSourceManifest,
  ProjectCitationDiagnostic,
} from "./project-grounded-answer-contract";

export type ProjectCitationPart =
  | { readonly type: "text"; readonly value: string }
  | {
      readonly type: "citation";
      readonly raw: string;
      readonly sourceId: string;
      readonly seconds: number;
      readonly href: string;
      readonly title: string;
    };

const TIMESTAMP_VALUE = String.raw`(?:\d{2}:)?\d{2}:\d{2}`;
const CANONICAL_CITATION = new RegExp(
  String.raw`\[(S\d{1,2}) @ (${TIMESTAMP_VALUE})(?:[-\u2013](${TIMESTAMP_VALUE}))?\]`,
  "g",
);
const BRACKET_CANDIDATE = /\[[^\]\n]{1,80}\]/g;

function parseTimestamp(value: string): number | null {
  const components = value.split(":").map(Number);
  if (
    components.some((component) => !Number.isInteger(component)) ||
    components.length < 2 ||
    components.length > 3
  ) {
    return null;
  }
  if (components.length === 2) {
    const [minutes, seconds] = components;
    return minutes >= 0 && seconds < 60 ? minutes * 60 + seconds : null;
  }
  const [hours, minutes, seconds] = components;
  return hours >= 0 && minutes < 60 && seconds < 60
    ? hours * 3600 + minutes * 60 + seconds
    : null;
}

function validationFor(
  raw: string,
  sourceId: string,
  timestamp: string,
  manifest: ProjectAnswerSourceManifest,
  endTimestamp?: string,
) {
  const source = manifest.sources.find(
    (candidate) => candidate.sourceId === sourceId,
  );
  if (!source) {
    return {
      diagnostic: {
        kind: "unknown_source",
        raw,
        sourceId,
      } satisfies ProjectCitationDiagnostic,
    };
  }
  const seconds = parseTimestamp(timestamp);
  const endSeconds = endTimestamp ? parseTimestamp(endTimestamp) : null;
  const passage = source.passages.find(
    (candidate) => Math.floor(candidate.startSeconds) === seconds,
  );
  if (
    seconds === null ||
    !passage ||
    (endTimestamp !== undefined &&
      (endSeconds === null ||
        endSeconds <= seconds ||
        passage.endSeconds === null ||
        Math.floor(passage.endSeconds) !== endSeconds))
  ) {
    return {
      diagnostic: {
        kind: "timestamp_not_in_evidence",
        raw,
        sourceId,
      } satisfies ProjectCitationDiagnostic,
    };
  }
  return {
    citation: {
      type: "citation" as const,
      raw,
      sourceId,
      seconds,
      href: `https://www.youtube.com/watch?v=${source.youtubeVideoId}&t=${seconds}s`,
      title: source.title ?? `Source ${sourceId}`,
    },
  };
}

export function inspectProjectCitations(
  content: string,
  manifest: ProjectAnswerSourceManifest,
) {
  const diagnostics: ProjectCitationDiagnostic[] = [];
  let validCitationCount = 0;
  const canonicalRaw = new Set<string>();
  for (const match of content.matchAll(CANONICAL_CITATION)) {
    canonicalRaw.add(`${match.index}:${match[0]}`);
    const validation = validationFor(
      match[0],
      match[1],
      match[2],
      manifest,
      match[3],
    );
    if (validation.citation) validCitationCount += 1;
    if (validation.diagnostic && diagnostics.length < 20) {
      diagnostics.push(validation.diagnostic);
    }
  }
  for (const match of content.matchAll(BRACKET_CANDIDATE)) {
    const raw = match[0];
    if (
      diagnostics.length >= 20 ||
      canonicalRaw.has(`${match.index}:${raw}`) ||
      (!/\bS\d+/i.test(raw) && !/@\s*\d/.test(raw))
    ) {
      continue;
    }
    diagnostics.push({ kind: "malformed", raw });
  }
  const unclosed = content.match(/\[S\d{1,2}\s*@\s*[^\]\n]{0,60}$/i)?.[0];
  if (unclosed && diagnostics.length < 20) {
    diagnostics.push({ kind: "malformed", raw: unclosed.slice(0, 80) });
  }
  return { diagnostics, validCitationCount } as const;
}

export function parseProjectCitations(
  content: string,
  manifest: ProjectAnswerSourceManifest,
): ProjectCitationPart[] {
  const parts: ProjectCitationPart[] = [];
  let lastIndex = 0;
  for (const match of content.matchAll(CANONICAL_CITATION)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ type: "text", value: content.slice(lastIndex, index) });
    }
    const validation = validationFor(
      match[0],
      match[1],
      match[2],
      manifest,
      match[3],
    );
    parts.push(
      validation.citation ?? { type: "text", value: match[0] },
    );
    lastIndex = index + match[0].length;
  }
  if (lastIndex < content.length) {
    parts.push({ type: "text", value: content.slice(lastIndex) });
  }
  return parts;
}
