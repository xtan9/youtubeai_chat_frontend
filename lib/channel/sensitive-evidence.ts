import { z } from "zod";

import {
  SAFETY_EVIDENCE_REVEAL_PURPOSES,
  type SafetyEvidenceRevealConfirmation,
  type SafetyEvidenceRevealPurpose,
} from "../channel-safety-contract";
import {
  SAFETY_FLAG_LABEL,
  SafetyFlagReasonSchema,
  type SafetyFlagReason,
} from "./safety";

export {
  SAFETY_EVIDENCE_REVEAL_WARNING,
} from "../channel-safety-contract";
export type {
  SafetyEvidenceRevealConfirmation,
  SafetyEvidenceRevealPurpose,
} from "../channel-safety-contract";

export const SENSITIVE_EVIDENCE_CATEGORIES = [
  "address",
  "phone",
  "email",
  "school",
  "identity_document",
  "location",
  "account_or_credential",
] as const;

export type SensitiveEvidenceCategory =
  (typeof SENSITIVE_EVIDENCE_CATEGORIES)[number];

export type SafetyEvidenceBoundary =
  | "model"
  | "log"
  | "draft"
  | "default_export";

export type MaskedSafetyEvidence = Readonly<{
  maskedText: string;
  categories: readonly SensitiveEvidenceCategory[];
  redactionCount: number;
}>;

export const SafetyEvidenceRevealPurposeSchema = z.enum(
  SAFETY_EVIDENCE_REVEAL_PURPOSES,
);

const SafetyEvidenceRevealConfirmationSchema = z
  .object({
    warningAcknowledged: z.literal(true),
    purpose: SafetyEvidenceRevealPurposeSchema,
  })
  .strict();

export type RevealedSafetyEvidence = Readonly<{
  text: string;
  purpose: SafetyEvidenceRevealPurpose;
}>;

export type ProtectedSafetyEvidence = MaskedSafetyEvidence &
  Readonly<{
    modelText: string;
    logText: string;
    draftText: string;
    defaultExportText: string;
    reveal: (
      confirmation: SafetyEvidenceRevealConfirmation,
    ) => RevealedSafetyEvidence;
  }>;

type RedactionMatch = Readonly<{
  start: number;
  end: number;
  category: SensitiveEvidenceCategory;
  priority: number;
}>;

type RedactionPattern = Readonly<{
  category: SensitiveEvidenceCategory;
  priority: number;
  expression: RegExp;
}>;

const REDACTION_PATTERNS: readonly RedactionPattern[] = [
  {
    category: "identity_document",
    priority: 0,
    expression:
      /\b(?:passport|driver['’]?s?\s+licen[cs]e|national\s+id(?:entity)?|identity\s+document|social\s+security(?:\s+number)?|ssn|id\s+card)\s*(?:number|no\.?|#|id)?\s*[:#-]?\s*[A-Z0-9][A-Z0-9 -]{3,30}\b/gi,
  },
  {
    category: "identity_document",
    priority: 1,
    expression: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    category: "identity_document",
    priority: 2,
    expression: /(?:护照|身份证(?:号)?|驾照)\s*[:：#-]?\s*[A-Z0-9-]{4,30}/giu,
  },
  {
    category: "account_or_credential",
    priority: 3,
    expression:
      /\b(?:api\s*key|access\s*token|auth(?:entication)?\s*token|password|passcode|secret|bank\s+account|account\s+number|credit\s+card)\s*(?:is|number|no\.?|#|:|=)\s*[A-Z0-9._~+/=-]{4,}\b/gi,
  },
  {
    category: "email",
    priority: 4,
    expression: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  },
  {
    category: "phone",
    priority: 5,
    expression:
      /(?<!\w)(?:\+?\d{1,3}[\s.-])?(?:\(?\d{2,4}\)?[\s.-])?\d{3}[\s.-]\d{4}(?!\w)|(?<!\w)\d{10,15}(?!\w)/g,
  },
  {
    category: "location",
    priority: 6,
    expression:
      /\b(?:gps|coordinates?|my\s+(?:current\s+)?location)\s*(?:are|is|:|=)?\s*-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}\b/gi,
  },
  {
    category: "location",
    priority: 7,
    expression: /\b-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}\b/g,
  },
  {
    category: "address",
    priority: 8,
    expression:
      /\b(?:my|our|their)\s+(?:home\s+)?address\s*(?:is|:|=)\s*[^.!?\n;]{3,100}/gi,
  },
  {
    category: "address",
    priority: 9,
    expression:
      /\b(?:at|visit|from)\s+\d{1,6}\s+(?:[A-Z0-9.'’-]+\s+){0,6}(?:street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|court|ct\.?|way|place|pl\.?|parkway|pkwy\.?|terrace|ter\.?|trail|trl\.?|highway|hwy\.?)\b(?:\s*,?\s*[A-Z][^.!?\n;]{0,60})?/gi,
  },
  {
    category: "address",
    priority: 10,
    expression:
      /\b\d{1,6}\s+(?:[A-Z0-9.'’-]+\s+){0,6}(?:street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|court|ct\.?|way|place|pl\.?|parkway|pkwy\.?|terrace|ter\.?|trail|trl\.?|highway|hwy\.?)\b(?:\s*,?\s*[A-Z][^.!?\n;]{0,60})?/gi,
  },
  {
    category: "address",
    priority: 10,
    expression:
      /(?:住址|地址|住在)\s*[^。！？!?\n;]{3,100}/gu,
  },
  {
    category: "school",
    priority: 11,
    expression:
      /\b(?:[A-Za-z0-9][A-Za-z0-9_-]*\s+){0,6}(?:high school|middle school|elementary school|primary school|school|university|college)\b/gi,
  },
  {
    category: "school",
    priority: 12,
    expression: /(?:[\p{Script=Han}]{2,20}(?:小学|中学|高中|大学|学院))/gu,
  },
];

function findRedactions(text: string): RedactionMatch[] {
  const matches: RedactionMatch[] = [];

  for (const pattern of REDACTION_PATTERNS) {
    for (const match of text.matchAll(pattern.expression)) {
      const value = match[0];
      const start = match.index ?? -1;
      if (start < 0 || value.length === 0) continue;
      matches.push({
        start,
        end: start + value.length,
        category: pattern.category,
        priority: pattern.priority,
      });
    }
  }

  matches.sort(
    (left, right) =>
      left.start - right.start ||
      left.priority - right.priority ||
      right.end - right.start - (left.end - left.start),
  );

  const selected: RedactionMatch[] = [];
  let cursor = -1;
  for (const match of matches) {
    if (match.start < cursor) continue;
    selected.push(match);
    cursor = match.end;
  }
  return selected;
}

function placeholder(category: SensitiveEvidenceCategory): string {
  return `[REDACTED ${category.replaceAll("_", " ").toUpperCase()}]`;
}

export function maskSensitiveEvidence(text: string): MaskedSafetyEvidence {
  if (typeof text !== "string") {
    throw new TypeError("Safety Flag evidence must be text");
  }

  const matches = findRedactions(text);
  let maskedText = "";
  let cursor = 0;
  const categories: SensitiveEvidenceCategory[] = [];

  for (const match of matches) {
    maskedText += text.slice(cursor, match.start);
    maskedText += placeholder(match.category);
    cursor = match.end;
    if (!categories.includes(match.category)) categories.push(match.category);
  }
  maskedText += text.slice(cursor);

  return Object.freeze({
    maskedText,
    categories: Object.freeze(categories),
    redactionCount: matches.length,
  });
}

export function createProtectedSafetyEvidence(
  rawText: string,
): ProtectedSafetyEvidence {
  const masked = maskSensitiveEvidence(rawText);

  const reveal = (
    confirmation: SafetyEvidenceRevealConfirmation,
  ): RevealedSafetyEvidence => {
    if (confirmation?.warningAcknowledged !== true) {
      throw new Error("Acknowledge the sensitive-evidence warning before revealing");
    }
    const parsedConfirmation =
      SafetyEvidenceRevealConfirmationSchema.safeParse(confirmation);
    if (!parsedConfirmation.success) {
      throw new Error("A valid reveal purpose is required");
    }
    return {
      text: rawText,
      purpose: parsedConfirmation.data.purpose,
    };
  };

  return Object.freeze({
    ...masked,
    modelText: masked.maskedText,
    logText: masked.maskedText,
    draftText: masked.maskedText,
    defaultExportText: masked.maskedText,
    reveal,
  });
}

export function getSafetyEvidenceForBoundary(
  evidence: ProtectedSafetyEvidence,
  boundary: SafetyEvidenceBoundary,
): string {
  const projections: Record<SafetyEvidenceBoundary, string> = {
    model: evidence.modelText,
    log: evidence.logText,
    draft: evidence.draftText,
    default_export: evidence.defaultExportText,
  };
  const projection = projections[boundary];
  if (typeof projection !== "string") {
    throw new Error("Unknown Safety Flag evidence boundary");
  }
  return projection;
}

export function revealSafetyEvidence(
  evidence: ProtectedSafetyEvidence,
  confirmation: SafetyEvidenceRevealConfirmation,
): RevealedSafetyEvidence {
  return evidence.reveal(confirmation);
}

export type SafetyFlagDefaultExport = Readonly<{
  version: 1;
  id: string;
  classification: typeof SAFETY_FLAG_LABEL;
  reasons: readonly SafetyFlagReason[];
  evidence: string;
  replyDraft: null;
}>;

export function buildSafetyFlagDefaultExport(input: {
  id: string;
  reasons: readonly SafetyFlagReason[];
  evidence: ProtectedSafetyEvidence;
}): SafetyFlagDefaultExport {
  const reasons = SafetyFlagReasonSchema.array().safeParse(input.reasons);
  if (!reasons.success) {
    throw new Error("Safety Flag reasons must be validated codes");
  }

  return Object.freeze({
    version: 1,
    id: input.id,
    classification: SAFETY_FLAG_LABEL,
    reasons: Object.freeze([...reasons.data]),
    evidence: getSafetyEvidenceForBoundary(input.evidence, "default_export"),
    replyDraft: null,
  });
}
