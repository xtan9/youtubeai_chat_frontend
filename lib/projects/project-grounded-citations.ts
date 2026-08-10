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

export type CanonicalProjectCitationToken = {
  readonly raw: string;
  readonly start: number;
  readonly end: number;
  readonly sourceId: string;
  readonly timestamp: string;
  readonly endTimestamp?: string;
};

function bracketCandidates(content: string): readonly BracketCandidate[] {
  const characters = Array.from(content);
  const candidates: BracketCandidate[] = [];
  let depth = 0;
  let startCharacterIndex = 0;
  let startCodeUnitIndex = 0;
  let codeUnitIndex = 0;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === "[") {
      if (depth === 0) {
        startCharacterIndex = index;
        startCodeUnitIndex = codeUnitIndex;
      }
      depth += 1;
    } else if (character === "]" && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        const end = codeUnitIndex + character.length;
        candidates.push({
          raw: characters.slice(startCharacterIndex, index + 1).join(""),
          start: startCodeUnitIndex,
          end,
          closed: true,
        });
      }
    }
    codeUnitIndex += character.length;
  }
  if (depth > 0) {
    candidates.push({
      raw: characters.slice(startCharacterIndex).join(""),
      start: startCodeUnitIndex,
      end: content.length,
      closed: false,
    });
  }
  return candidates;
}

export function findCanonicalProjectCitationTokens(
  content: string,
): readonly CanonicalProjectCitationToken[] {
  return bracketCandidates(content).flatMap((candidate) => {
    const match = candidate.closed
      ? CANONICAL_CITATION.exec(candidate.raw)
      : null;
    if (!match) return [];
    return [{
      raw: candidate.raw,
      start: candidate.start,
      end: candidate.end,
      sourceId: match[1],
      timestamp: match[2],
      ...(match[3] === undefined ? {} : { endTimestamp: match[3] }),
    }];
  });
}

function looksLikeCitation(raw: string) {
  return /\bS\d+/i.test(raw) || /@\s*\d/.test(raw);
}

function diagnosticRaw(raw: string) {
  return Array.from(raw).slice(0, 80).join("");
}

function claimRanges(content: string) {
  const characters = Array.from(content);
  const ranges: Array<readonly [number, number]> = [];
  let depth = 0;
  let claimStart = 0;
  let codeUnitIndex = 0;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === "[") depth += 1;
    else if (character === "]" && depth > 0) depth -= 1;
    const claimEnd = codeUnitIndex + character.length;
    const next = characters[index + 1];
    if (
      depth === 0 &&
      (character === "\n" ||
        (/[.!?\u3002\uff01\uff1f]/u.test(character) &&
          (next === undefined || /\s/u.test(next))))
    ) {
      ranges.push([claimStart, claimEnd]);
      claimStart = claimEnd;
    }
    codeUnitIndex = claimEnd;
  }
  if (claimStart < content.length) ranges.push([claimStart, content.length]);
  return ranges;
}

function isPresentationHeading(prose: string) {
  return /^(?:#{1,6}\s*)?(?:project assessment|source-supported observations|proposed questions and creative opportunities|repeated evidence|model interpretation|agreements|disagreements|competing positions|criteria|confidence(?:\s*:\s*(?:high|medium|low))?)\s*:?$/iu.test(
    prose.trim(),
  );
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
  const validCitations: CanonicalProjectCitationToken[] = [];
  const validSourceIds = new Set<string>();
  const candidates = bracketCandidates(content);
  const canonicalByStart = new Map(
    findCanonicalProjectCitationTokens(content).map((token) => [
      token.start,
      token,
    ]),
  );
  for (const candidate of candidates) {
    const token = canonicalByStart.get(candidate.start);
    if (!token) {
      if (diagnostics.length < 20 && looksLikeCitation(candidate.raw)) {
        diagnostics.push({
          kind: "malformed",
          raw: diagnosticRaw(candidate.raw),
        });
      }
      continue;
    }
    const validation = validationFor(
      token.raw,
      token.sourceId,
      token.timestamp,
      manifest,
      token.endTimestamp,
    );
    if (validation.citation) {
      validCitations.push(token);
      validSourceIds.add(token.sourceId);
    }
    if (validation.diagnostic && diagnostics.length < 20) {
      diagnostics.push(validation.diagnostic);
    }
  }

  let allClaimsCited = true;
  let hasClaim = false;
  let candidateIndex = 0;
  let validCitationIndex = 0;
  for (const [claimStart, claimEnd] of claimRanges(content)) {
    while (
      candidateIndex < candidates.length &&
      candidates[candidateIndex].end <= claimStart
    ) {
      candidateIndex += 1;
    }
    let prose = "";
    let proseStart = claimStart;
    let nextCandidateIndex = candidateIndex;
    while (
      nextCandidateIndex < candidates.length &&
      candidates[nextCandidateIndex].start < claimEnd
    ) {
      const candidate = candidates[nextCandidateIndex];
      if (candidate.start >= claimStart && candidate.end <= claimEnd) {
        prose += content.slice(proseStart, candidate.start);
        proseStart = candidate.end;
      }
      nextCandidateIndex += 1;
    }
    prose += content.slice(proseStart, claimEnd);
    candidateIndex = nextCandidateIndex;

    while (
      validCitationIndex < validCitations.length &&
      validCitations[validCitationIndex].end <= claimStart
    ) {
      validCitationIndex += 1;
    }
    const claimHasValidCitation =
      validCitationIndex < validCitations.length &&
      validCitations[validCitationIndex].start >= claimStart &&
      validCitations[validCitationIndex].end <= claimEnd;
    if (/[\p{L}\p{N}]/u.test(prose) && !isPresentationHeading(prose)) {
      hasClaim = true;
      if (!claimHasValidCitation) allClaimsCited = false;
    }
  }

  return {
    diagnostics,
    validCitationCount: validCitations.length,
    validSourceIds: [...validSourceIds].sort(),
    allClaimsCited: hasClaim && allClaimsCited,
  } as const;
}

export function parseProjectCitations(
  content: string,
  manifest: ProjectAnswerSourceManifest,
): ProjectCitationPart[] {
  const parts: ProjectCitationPart[] = [];
  let lastIndex = 0;
  for (const token of findCanonicalProjectCitationTokens(content)) {
    const index = token.start;
    if (index > lastIndex) {
      parts.push({ type: "text", value: content.slice(lastIndex, index) });
    }
    const validation = validationFor(
      token.raw,
      token.sourceId,
      token.timestamp,
      manifest,
      token.endTimestamp,
    );
    parts.push(validation.citation ?? { type: "text", value: token.raw });
    lastIndex = token.end;
  }
  if (lastIndex < content.length) {
    parts.push({ type: "text", value: content.slice(lastIndex) });
  }
  return parts;
}
