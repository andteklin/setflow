import type { SectionType } from "../types.js";

interface SectionPattern {
  type: SectionType;
  abbr: string;
  re: RegExp;
}

/**
 * Ordered so more specific prefixes (e.g. "Pre-Chorus") are tried before
 * the more general ones they'd otherwise also match (e.g. "Chorus").
 */
const SECTION_PATTERNS: SectionPattern[] = [
  { type: "prechorus", abbr: "PC", re: /^pre-?\s*chorus\b/i },
  { type: "instrumental", abbr: "INST", re: /^instrumental\b/i },
  { type: "interlude", abbr: "INT", re: /^interlude\b/i },
  { type: "intro", abbr: "I", re: /^intro(duction)?\b/i },
  { type: "verse", abbr: "V", re: /^verse\b/i },
  { type: "chorus", abbr: "C", re: /^chorus\b/i },
  { type: "bridge", abbr: "B", re: /^bridge\b/i },
  { type: "tag", abbr: "T", re: /^tag\b/i },
  { type: "outro", abbr: "O", re: /^outro\b/i },
  { type: "ending", abbr: "E", re: /^end(ing)?\b/i },
];

const NUMBER_LETTER_SUFFIX = /(\d+)\s*([a-zA-Z])?/;

function customAbbreviation(label: string): string {
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words.map((w) => w[0]?.toUpperCase() ?? "").join("");
  }
  return label.slice(0, 4).toUpperCase();
}

export interface SectionClassification {
  type: SectionType;
  label: string;
}

/**
 * Normalizes a source section label (e.g. "Chorus 1a") into SetFlow's
 * compact representation (type: "chorus", label: "C1A"). The original
 * label is never modified by this function -- callers must keep it
 * separately as `sourceLabel`.
 */
export function classifySection(sourceLabel: string): SectionClassification {
  const trimmed = sourceLabel.trim();

  for (const pattern of SECTION_PATTERNS) {
    const match = trimmed.match(pattern.re);
    if (!match) continue;

    const rest = trimmed.slice(match[0].length);
    const suffixMatch = rest.match(NUMBER_LETTER_SUFFIX);
    const suffix = suffixMatch
      ? suffixMatch[1] + (suffixMatch[2] ? suffixMatch[2].toUpperCase() : "")
      : "";

    return { type: pattern.type, label: pattern.abbr + suffix };
  }

  return { type: "custom", label: customAbbreviation(trimmed) };
}

/**
 * Keywords that strongly suggest a `{comment: ...}` is a performance note
 * ("Acoustic guitar only", "Build here") rather than a section boundary.
 * This is a heuristic per spec section 6 -- ambiguous cases fall back to
 * "not a section" so information is preserved as an annotation instead of
 * being silently misclassified as structure.
 */
const ANNOTATION_KEYWORDS = new Set([
  "only",
  "here",
  "please",
  "watch",
  "cue",
  "count",
  "wait",
  "build",
  "softly",
  "loudly",
  "quiet",
  "quietly",
  "acoustic",
  "electric",
  "click",
  "guitar",
  "guitars",
  "drums",
  "bass",
  "piano",
  "vocals",
  "hold",
  "fade",
  "stop",
  "start",
  "solo",
  "half",
  "full",
  "band",
  "in",
  "out",
  "up",
  "down",
]);

const MAX_SECTION_LABEL_WORDS = 3;

/**
 * Decides whether a `{comment: ...}` value should begin a new SongSection
 * or be preserved as a SongAnnotation. Known section names (verse, chorus,
 * bridge, ...) always win; anything else is judged on length and whether it
 * reads like an instruction rather than a short section name.
 */
export function isLikelySection(commentText: string): boolean {
  const classification = classifySection(commentText);
  if (classification.type !== "custom") return true;

  const words = commentText.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  if (words.length > MAX_SECTION_LABEL_WORDS) return false;
  if (words.some((w) => ANNOTATION_KEYWORDS.has(w))) return false;

  return true;
}
