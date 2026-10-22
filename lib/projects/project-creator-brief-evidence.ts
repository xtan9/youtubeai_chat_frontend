import type {
  ProjectAnswerSourceManifest,
  ProjectEvidenceSnapshot,
} from "./project-grounded-answer-contract";
import {
  findCanonicalProjectCitationTokens,
  parseProjectCitations,
} from "./project-grounded-citations";

const STOP_WORDS = new Set([
  "a", "also", "an", "and", "as", "at", "be", "because", "but", "by", "can",
  "could", "for", "from", "had", "has", "have", "how", "if", "in", "into",
  "is", "it", "its", "may", "of", "on", "or", "should", "that", "the",
  "their", "then", "this", "to", "too", "until", "was", "were", "what", "when",
  "where", "whether", "which", "while", "who", "why", "will", "with", "within", "would",
  "each", "inside", "more", "still", "than", "through", "using", "via",
]);

const IDEA_SCAFFOLD_WORDS = new Set([
  "angle", "ask", "combination", "counterargument", "decision", "explore",
  "frame", "gap", "idea", "inspiration", "inspired", "original", "pair",
  "proposed", "source", "video",
]);

export const CREATIVE_MECHANICS_WORDS = new Set([
  "angle", "ask", "asks", "beat", "build", "builds", "cautious",
  "certainty", "change", "changes", "check", "checks", "checklist", "choice",
  "choices", "combine", "combines", "compare", "compares", "contrast",
  "contrasts", "counterargument", "decision", "decisions", "dialogue",
  "difference", "differences", "eliminate", "eliminates", "explore", "explores",
  "false", "frame", "frames", "framework", "gap", "give", "gives", "lack",
  "lacks", "make", "makes", "map", "maps", "move", "open", "opens", "pair", "pairs",
  "question", "questions", "resolve", "resolves", "revisable", "show", "shows",
  "synthesis", "unfinished", "visible",
]);

const NEGATION_WORDS = new Set([
  "cannot", "neither", "never", "no", "not", "without",
]);

export const NARRATIVE_ROLES = [
  "hook",
  "context",
  "claim",
  "evidence",
  "example",
  "process",
  "problem",
  "failure",
  "contrast",
  "question",
  "decision",
  "delay",
  "resolution",
  "callback",
  "comparison",
  "synthesis",
  "framework",
  "reflection",
  "demonstration",
  "chronology",
  "interview",
] as const;

type NarrativeRole = (typeof NARRATIVE_ROLES)[number];

const NARRATIVE_ROLE_SET = new Set<string>(NARRATIVE_ROLES);

const NARRATIVE_ROLE_WORDS: Readonly<Record<NarrativeRole, ReadonlySet<string>>> = {
  hook: new Set(["begin", "begins", "beginning", "countdown", "open", "opens", "start", "starts"]),
  context: new Set(["background", "context", "setting"]),
  claim: new Set(["argument", "claim", "claims", "thesis"]),
  evidence: new Set(["data", "evidence", "proof", "test", "testing", "tests"]),
  example: new Set(["case", "example", "illustration"]),
  process: new Set(["method", "process", "steps", "workflow"]),
  problem: new Set(["challenge", "issue", "problem"]),
  failure: new Set(["fail", "failed", "failing", "failure", "failures"]),
  contrast: new Set(["contrast", "difference", "versus"]),
  question: new Set(["ask", "question", "why"]),
  decision: new Set(["choice", "choose", "decision", "decisions", "decide"]),
  delay: new Set(["delay", "delayed", "pause", "postpone", "waiting"]),
  resolution: new Set(["answer", "resolve", "resolution", "solution"]),
  callback: new Set(["end", "ends", "finish", "finishes", "return", "returns"]),
  comparison: new Set(["compare", "comparison", "pair"]),
  synthesis: new Set(["combine", "combination", "synthesis", "synthesize"]),
  framework: new Set(["framework", "map", "model"]),
  reflection: new Set(["reflect", "reflection", "reconsider"]),
  demonstration: new Set(["demonstrate", "demonstration"]),
  chronology: new Set(["chronology", "history", "timeline"]),
  interview: new Set(["interview", "interviews"]),
};

function normalizedWords(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

function contentWords(value: string) {
  return normalizedWords(value).filter((word) => !STOP_WORDS.has(word));
}

function ideaWords(value: string) {
  return contentWords(value).filter((word) => !IDEA_SCAFFOLD_WORDS.has(word));
}

function setOverlap(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) count += 1;
  }
  return count;
}

function hasDistinctiveCopiedPhrase(outputWords: readonly string[], sourceWords: readonly string[]) {
  const output = ` ${outputWords.join(" ")} `;
  for (let length = 4; length <= sourceWords.length; length += 1) {
    for (let index = 0; index <= sourceWords.length - length; index += 1) {
      const phraseWords = sourceWords.slice(index, index + length);
      const meaningful = phraseWords.filter((word) => !STOP_WORDS.has(word));
      if (
        (length >= 6 ||
          (meaningful.length >= 2 && meaningful.join("").length >= 14)) &&
        output.includes(` ${phraseWords.join(" ")} `)
      ) {
        return true;
      }
    }
  }
  return false;
}

function hasReorderedSourceFraming(outputLine: string, sourceText: string) {
  const outputTerms = new Set(contentWords(outputLine));
  const sourceTerms = new Set(contentWords(sourceText));
  const shared = setOverlap(outputTerms, sourceTerms);
  const smallerVocabulary = Math.min(outputTerms.size, sourceTerms.size);
  return shared >= 6 && smallerVocabulary > 0 && shared / smallerVocabulary >= 0.7;
}

export function containsSourceImitation(
  content: string,
  evidenceSnapshot: ProjectEvidenceSnapshot,
) {
  const outputLines = content.split(/\r?\n/u).filter((line) => line.trim());
  return evidenceSnapshot.passages.some((passage) => {
    const sourceWords = normalizedWords(passage.text);
    return outputLines.some(
      (line) =>
        hasDistinctiveCopiedPhrase(normalizedWords(line), sourceWords) ||
        hasReorderedSourceFraming(line, passage.text),
    );
  });
}

export function detectedNarrativeRoles(value: string) {
  const roles: Array<{ readonly role: NarrativeRole; readonly position: number }> = [];
  const words = normalizedWords(value);
  for (const role of NARRATIVE_ROLES) {
    const position = words.findIndex((word) => NARRATIVE_ROLE_WORDS[role].has(word));
    if (position >= 0) roles.push({ role, position });
  }
  return roles
    .sort((left, right) => left.position - right.position)
    .map(({ role }) => role);
}

export function hasCopiedNarrativeSequence(
  content: string,
  evidenceSnapshot: ProjectEvidenceSnapshot,
) {
  const proposedLines = content
    .split(/\r?\n/u)
    .filter((line) => line.trim().startsWith("- Proposed beat:"));
  return evidenceSnapshot.passages.some((passage) => {
    const sourceRoles = detectedNarrativeRoles(passage.text);
    if (sourceRoles.length < 3) return false;
    return proposedLines.some((line) => {
      const proposal = parseTraceableProposal(line);
      const proposedRoles = detectedNarrativeRoles(
        proposal?.originalMove ?? line,
      );
      const sharedSourceRoles = sourceRoles.filter((role) =>
        proposedRoles.includes(role),
      );
      const sharedProposedRoles = proposedRoles.filter((role) =>
        sourceRoles.includes(role),
      );
      return (
        sharedSourceRoles.length >= 3 &&
        sharedSourceRoles.every(
          (role, index) => role === sharedProposedRoles[index],
        )
      );
    });
  });
}

function citedEvidenceWordSets(
  line: string,
  sourceManifest: ProjectAnswerSourceManifest,
  evidenceSnapshot: ProjectEvidenceSnapshot,
) {
  return citedEvidenceWordSequences(line, sourceManifest, evidenceSnapshot).map(
    (words) => new Set(words),
  );
}

function citedEvidenceWordSequences(
  line: string,
  sourceManifest: ProjectAnswerSourceManifest,
  evidenceSnapshot: ProjectEvidenceSnapshot,
) {
  const citedPassageIds = new Set<string>();
  for (const citation of parseProjectCitations(line, sourceManifest)) {
    if (citation.type !== "citation") continue;
    const source = sourceManifest.sources.find(
      (candidate) => candidate.sourceId === citation.sourceId,
    );
    const passage = source?.passages.find(
      (candidate) => Math.floor(candidate.startSeconds) === citation.seconds,
    );
    if (passage) citedPassageIds.add(passage.passageId);
  }
  return evidenceSnapshot.passages
    .filter((passage) => citedPassageIds.has(passage.passageId))
    .map((passage) => contentWords(passage.text));
}

function stripCitationTokens(value: string) {
  const tokens = findCanonicalProjectCitationTokens(value);
  let stripped = value;
  for (const token of [...tokens].reverse()) {
    stripped = stripped.slice(0, token.start) + stripped.slice(token.end);
  }
  return stripped;
}

export function hasSingleTerminalCitation(line: string) {
  const tokens = findCanonicalProjectCitationTokens(line);
  return (
    tokens.length === 1 &&
    /^[.!?]?\s*$/u.test(line.slice(tokens[0].end))
  );
}

function containsOnlyAllowedTerms(
  terms: ReadonlySet<string>,
  allowed: ReadonlySet<string>,
) {
  return [...terms].every((term) => allowed.has(term));
}

function orderedSubsequencePositions(
  terms: readonly string[],
  evidenceTerms: readonly string[],
) {
  const positions: number[] = [];
  let evidenceIndex = 0;
  for (const term of terms) {
    while (
      evidenceIndex < evidenceTerms.length &&
      evidenceTerms[evidenceIndex] !== term
    ) {
      evidenceIndex += 1;
    }
    if (evidenceIndex >= evidenceTerms.length) return null;
    positions.push(evidenceIndex);
    evidenceIndex += 1;
  }
  return positions;
}

export function parseTraceableProposal(line: string) {
  const match = /^- (?:Gap|Combination|Counterargument|Original angle|Proposed beat): Evidence basis: ([^;\r\n]+); Goal fit: ([^;\r\n]+); Original move: (.+)$/u.exec(
    line.trim(),
  );
  if (!match) return null;
  return {
    evidenceBasis: match[1],
    goalFit: match[2],
    originalMove: match[3],
  };
}

export function traceableProposalSupport(
  line: string,
  goal: string | null,
  sourceManifest: ProjectAnswerSourceManifest,
  evidenceSnapshot: ProjectEvidenceSnapshot,
) {
  const parsed = parseTraceableProposal(line);
  if (!parsed) return "invalid_structure" as const;
  const basisTerms = new Set(ideaWords(parsed.evidenceBasis));
  const goalFitTerms = new Set(contentWords(parsed.goalFit));
  const moveTerms = new Set(
    contentWords(stripCitationTokens(parsed.originalMove)),
  );
  const goalTerms = new Set(contentWords(goal ?? ""));
  const requiredGoalTerms = Math.min(2, goalTerms.size);
  if (
    requiredGoalTerms > 0 &&
    setOverlap(goalFitTerms, goalTerms) < requiredGoalTerms
  ) {
    return "goal_irrelevant" as const;
  }
  const evidenceWordSets = citedEvidenceWordSets(
    line,
    sourceManifest,
    evidenceSnapshot,
  );
  const evidenceSupportSets = evidenceWordSets.map((terms) => {
    const evidenceSpecificTerms = new Set(
      [...terms].filter((term) => !goalTerms.has(term)),
    );
    return evidenceSpecificTerms.size >= 2 ? evidenceSpecificTerms : terms;
  });
  const allEvidenceTerms = new Set(
    evidenceWordSets.flatMap((terms) => [...terms]),
  );
  const allowedBasisTerms = new Set([
    ...allEvidenceTerms,
    ...CREATIVE_MECHANICS_WORDS,
  ]);
  const allowedGoalFitTerms = new Set([
    ...goalTerms,
    ...CREATIVE_MECHANICS_WORDS,
  ]);
  const allowedMoveTerms = new Set([
    ...allEvidenceTerms,
    ...goalTerms,
    ...CREATIVE_MECHANICS_WORDS,
  ]);
  if (
    evidenceSupportSets.length === 0 ||
    !containsOnlyAllowedTerms(
      new Set(contentWords(parsed.evidenceBasis)),
      allowedBasisTerms,
    ) ||
    !containsOnlyAllowedTerms(goalFitTerms, allowedGoalFitTerms) ||
    !containsOnlyAllowedTerms(moveTerms, allowedMoveTerms) ||
    evidenceSupportSets.some((supportTerms) => {
      return (
        supportTerms.size === 0 ||
        setOverlap(basisTerms, supportTerms) < Math.min(2, supportTerms.size)
      );
    })
  ) {
    return "unsupported_inspiration" as const;
  }
  if (
    evidenceSupportSets.some(
      (supportTerms) =>
        setOverlap(moveTerms, supportTerms) < Math.min(2, supportTerms.size),
    ) ||
    (requiredGoalTerms > 0 &&
      setOverlap(moveTerms, goalTerms) < requiredGoalTerms)
  ) {
    return "unsupported_inspiration" as const;
  }
  return null;
}

export function sourceClaimIsSupported(
  line: string,
  sourceManifest: ProjectAnswerSourceManifest,
  evidenceSnapshot: ProjectEvidenceSnapshot,
) {
  const claimWords = contentWords(
      stripCitationTokens(
        line.trim().slice("- Inspiration:".length),
      ),
    );
  const claimTerms = new Set(claimWords);
  const evidenceWordSequences = citedEvidenceWordSequences(
    line,
    sourceManifest,
    evidenceSnapshot,
  );
  const allEvidenceTerms = new Set(
    evidenceWordSequences.flatMap((terms) => terms),
  );
  return (
    claimTerms.size > 0 &&
    evidenceWordSequences.length > 0 &&
    containsOnlyAllowedTerms(claimTerms, allEvidenceTerms) &&
    evidenceWordSequences.every((evidenceWords) => {
      const evidenceTerms = new Set(evidenceWords);
      const relevantClaimWords = claimWords.filter((word) =>
        evidenceTerms.has(word),
      );
      const positions = orderedSubsequencePositions(
        relevantClaimWords,
        evidenceWords,
      );
      if (
        !positions ||
        relevantClaimWords.length < Math.min(2, evidenceTerms.size)
      ) {
        return false;
      }
      const evidenceNegationCount = evidenceWords.filter((word) =>
        NEGATION_WORDS.has(word),
      ).length;
      const claimNegationCount = relevantClaimWords.filter((word) =>
        NEGATION_WORDS.has(word),
      ).length;
      return claimNegationCount === evidenceNegationCount;
    })
  );
}

export function parseNarrativeSequence(line: string, prefix: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith(prefix)) return null;
  const withoutCitations = stripCitationTokens(trimmed)
    .replace(/[.]$/u, "")
    .slice(prefix.length)
    .trim();
  const roles = withoutCitations.split(/\s*>\s*/u);
  if (
    roles.length !== 3 ||
    new Set(roles).size !== 3 ||
    roles.some((role) => !NARRATIVE_ROLE_SET.has(role))
  ) {
    return null;
  }
  return roles as readonly NarrativeRole[];
}

export function isRoleSubsequence(
  expected: readonly NarrativeRole[],
  detected: readonly NarrativeRole[],
) {
  let expectedIndex = 0;
  for (const role of detected) {
    if (role === expected[expectedIndex]) expectedIndex += 1;
  }
  return expectedIndex === expected.length;
}
