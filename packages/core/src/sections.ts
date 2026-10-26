import { CUSTOM_TYPE_ID, findSectionType } from "./sectionTypes.js";

// Name, optional number, optional letter: "Verse 1", "Chorus 1a", "Chorus A", "Bridge".
// A trailing repeat counter ("Bridge 2/3") is accepted so arranged output re-imports.
const LABEL_RE = /^(.*?)(?:[\s_-]*(\d+)(?:[\s_-]*([a-z]))?|[\s_-]+([a-z]))?(?:\s+\d+\/\d+)?$/i;

export interface SectionClassification {
  /** Vocabulary type id (e.g. "chorus"), or "custom" for names outside the vocabulary. */
  type: string;
  /** False for custom names. Their `token` is only a suggestion; see `suggestCustomTokens`. */
  known: boolean;
  /** Song-map token, e.g. "C1A". For custom names, the first suggestion. */
  token: string;
  /** Number and letter as one string, e.g. "1A"; empty when the name has none. */
  variant: string;
  /** Readable label: "Chorus 1A" for known types, the source text for custom ones. */
  displayLabel: string;
}

const clean = (raw: string) => raw.trim().replace(/:$/, "").trim();

/** Token candidates for a custom name, best first: "Big Chorus" → BC, BIGC, BIGCHO... */
export function suggestCustomTokens(label: string): string[] {
  const words = label.match(/[\p{L}\p{N}]+/gu) ?? [];
  const joined = words.join("").toUpperCase();
  if (joined === "") return ["SEC"];
  const candidates: string[] = [];
  if (words.length > 1) candidates.push(words.map((w) => w[0]).join("").toUpperCase().slice(0, 4));
  for (const n of [4, 6, 8]) candidates.push(joined.slice(0, n));
  return [...new Set(candidates)];
}

/**
 * Classify any section name. Never fails: names outside the vocabulary come
 * back as type "custom" with the source text as display label. Which comments
 * count as section markers at all is the parser's decision, not this function's.
 */
export function normalizeSectionLabel(raw: string): SectionClassification {
  const text = clean(raw);
  const m = LABEL_RE.exec(text);
  // The whole text may itself be a vocabulary name ("Instrumental Break", "Count In").
  const whole = findSectionType(text);
  const type = whole ?? (m ? findSectionType(m[1]) : undefined);

  if (!type) {
    return { type: CUSTOM_TYPE_ID, known: false, token: suggestCustomTokens(text)[0], variant: "", displayLabel: text };
  }
  const variant = whole ? "" : `${m![2] ?? ""}${(m![3] ?? m![4] ?? "").toUpperCase()}`;
  return {
    type: type.id,
    known: true,
    token: `${type.token}${variant}`,
    variant,
    displayLabel: variant ? `${type.displayName} ${variant}` : type.displayName,
  };
}

/**
 * Classify a section name from the vocabulary. Returns null when the name is
 * not recognized, so a caller can keep it as an annotation or a custom section.
 */
export function classifySectionLabel(raw: string): SectionClassification | null {
  const c = normalizeSectionLabel(raw);
  return c.known ? c : null;
}
