import type { SectionType } from "./types";

const TYPES: Record<string, { type: SectionType; code: string }> = {
  intro: { type: "intro", code: "I" },
  verse: { type: "verse", code: "V" },
  prechorus: { type: "prechorus", code: "PC" },
  chorus: { type: "chorus", code: "C" },
  bridge: { type: "bridge", code: "B" },
  instrumental: { type: "instrumental", code: "INST" },
  inst: { type: "instrumental", code: "INST" },
  interlude: { type: "interlude", code: "INT" },
  tag: { type: "tag", code: "T" },
  ending: { type: "ending", code: "E" },
  outro: { type: "outro", code: "O" },
};

// Name, optional number, optional letter: "Verse 1", "Chorus 1a", "Pre-Chorus 2", "Bridge".
// A trailing repeat counter ("Bridge 2/3") is accepted so arranged output re-imports.
const LABEL_RE =
  /^(pre[\s-]?chorus|intro|verse|chorus|bridge|instrumental|inst|interlude|tag|ending|outro)(?:\s*(\d+))?\s*([a-z])?(?:\s+\d+\/\d+)?$/i;

export interface SectionClassification {
  type: SectionType;
  /** Normalized label, e.g. "C1A". */
  label: string;
}

/**
 * Classify a `{comment: ...}` text as a section label. Returns null when the
 * comment is not a recognized section name; the caller keeps it as an annotation.
 */
export function classifySectionLabel(raw: string): SectionClassification | null {
  const m = LABEL_RE.exec(raw.trim().replace(/:$/, ""));
  if (!m) return null;
  const entry = TYPES[m[1].toLowerCase().replace(/[\s-]/g, "")];
  return { type: entry.type, label: `${entry.code}${m[2] ?? ""}${(m[3] ?? "").toUpperCase()}` };
}
