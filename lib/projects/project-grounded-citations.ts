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
  String.raw`^\[(S\d{1,2}) @ (${TIMESTAMP_VALUE})(?:[-\u2013](${TIMESTAMP_VALUE}))?\]$`,
);

type BracketCandidate = {
  readonly raw: string;
  readonly start: number;
  readonly end: number;
  readonly closed: boolean;
};

function bracketCandidates(content: string): readonly BracketCandidate[] {
  const candidates: BracketCandidate[] = [];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "[") continue;
    const start = index;
    let depth = 0;
    let closed = false;
    let end = content.length;
    for (let cursor = index; cursor < content.length; cursor += 1) {
      const character = content[cursor];
      if (character === "\n") {
        end = cursor;
        break;
      }
      if (character === "[") depth += 1;
      if (character !== "]") continue;
      depth -= 1;
      if (depth === 0) {
        end = cursor + 1;
        closed = true;
        break;
      }
    }
    candidates.push({
      raw: content.slice(start, end),
      start,
      end,
      closed,
    });
    index = Math.max(index, end - 1);
  }
  return candidates;
}

function looksLikeCitation(raw: string) {
  return /\bS\d+/i.test(raw) || /@\s*\d/.test(raw);
}

function diagnosticRaw(raw: string) {
  return raw.slice(0, 80);
}

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
  const validCitations: Array<BracketCandidate> = [];
  for (const candidate of bracketCandidates(content)) {
    const match = candidate.closed
      ? CANONICAL_CITATION.exec(candidate.raw)
      : null;
    if (!match) {
      if (
        diagnostics.length < 20 &&
        looksLikeCitation(candidate.raw)
      ) {
        diagnostics.push({
          kind: "malformed",
          raw: diagnosticRaw(candidate.raw),
        });
      }
      continue;
    }
    const validation = validationFor(
      candidate.raw,
      match[1],
      match[2],
      manifest,
      match[3],
    );
    if (validation.citation) validCitations.push(candidate);
    if (validation.diagnostic && diagnostics.length < 20) {
      diagnostics.push(validation.diagnostic);
    }
  }

  let allClaimsCited = true;
  let hasClaim = false;
  const claimBoundary = /[.!?\u3002\uff01\uff1f]+(?=\s|$)|\n+/gu;
  let claimStart = 0;
  const inspectClaim = (claimEnd: number) => {
    const claim = content.slice(claimStart, claimEnd);
    const candidates = bracketCandidates(claim);
    let prose = claim;
    for (const candidate of [...candidates].reverse()) {
      prose =
        prose.slice(0, candidate.start) + prose.slice(candidate.end);
    }
    if (/[\p{L}\p{N}]/u.test(prose)) {
      hasClaim = true;
      if (
        !validCitations.some(
          (citation) =>
            citation.start >= claimStart && citation.end <= claimEnd,
        )
      ) {
        allClaimsCited = false;
      }
    }
    claimStart = claimEnd;
  };
  for (const boundary of content.matchAll(claimBoundary)) {
    inspectClaim((boundary.index ?? 0) + boundary[0].length);
  }
  if (claimStart < content.length) inspectClaim(content.length);

  return {
    diagnostics,
    validCitationCount: validCitations.length,
    allClaimsCited: hasClaim && allClaimsCited,
  } as const;
}

export function parseProjectCitations(
  content: string,
  manifest: ProjectAnswerSourceManifest,
): ProjectCitationPart[] {
  const parts: ProjectCitationPart[] = [];
  let lastIndex = 0;
  for (const candidate of bracketCandidates(content)) {
    if (!candidate.closed) continue;
    const match = CANONICAL_CITATION.exec(candidate.raw);
    if (!match) continue;
    const index = candidate.start;
    if (index > lastIndex) {
      parts.push({ type: "text", value: content.slice(lastIndex, index) });
    }
    const validation = validationFor(
      candidate.raw,
      match[1],
      match[2],
      manifest,
      match[3],
    );
    parts.push(
      validation.citation ?? { type: "text", value: candidate.raw },
    );
    lastIndex = candidate.end;
  }
  if (lastIndex < content.length) {
    parts.push({ type: "text", value: content.slice(lastIndex) });
  }
  return parts;
}
