/**
 * The section-type vocabulary: the one place that knows which section names
 * exist. The parser asks `findSectionType`; it never lists names itself.
 *
 * The vocabulary is only for classifying and abbreviating names. A name that
 * is not here is still a valid (custom) section, so extending the list never
 * changes what the parser accepts, only how well it labels.
 */
export interface SectionType {
  /** Stable machine id, e.g. "prechorus". Stored on sections. */
  id: string;
  /** Human-readable name, e.g. "Pre-Chorus". */
  displayName: string;
  /** Short song-map token, e.g. "PC". Also matched as an alias. */
  token: string;
  /**
   * Accepted spellings. Matching ignores case, spaces, hyphens and
   * underscores, so "Pre Chorus" and "pre-chorus" need not be listed twice;
   * the common ones are listed anyway for readability.
   */
  aliases: readonly string[];
}

export const SECTION_TYPES: readonly SectionType[] = [
  { id: "countin", displayName: "Count-In", token: "CI", aliases: ["Count-In", "Count In", "Count Off"] },
  { id: "click", displayName: "Click", token: "CLK", aliases: ["Click"] },
  { id: "intro", displayName: "Intro", token: "I", aliases: ["Intro", "Introduction"] },
  { id: "verse", displayName: "Verse", token: "V", aliases: ["Verse", "Vs"] },
  { id: "prechorus", displayName: "Pre-Chorus", token: "PC", aliases: ["Pre-Chorus", "Pre Chorus", "Prechorus"] },
  { id: "chorus", displayName: "Chorus", token: "C", aliases: ["Chorus"] },
  { id: "postchorus", displayName: "Post-Chorus", token: "POC", aliases: ["Post-Chorus", "Post Chorus", "Postchorus"] },
  { id: "refrain", displayName: "Refrain", token: "RF", aliases: ["Refrain"] },
  { id: "hook", displayName: "Hook", token: "HK", aliases: ["Hook"] },
  { id: "bridge", displayName: "Bridge", token: "B", aliases: ["Bridge"] },
  { id: "instrumental", displayName: "Instrumental", token: "INST", aliases: ["Instrumental", "Instrumental Break", "Instr"] },
  { id: "interlude", displayName: "Interlude", token: "INT", aliases: ["Interlude"] },
  { id: "solo", displayName: "Solo", token: "SOLO", aliases: ["Solo", "Instrumental Solo"] },
  { id: "tag", displayName: "Tag", token: "T", aliases: ["Tag"] },
  { id: "vamp", displayName: "Vamp", token: "VAMP", aliases: ["Vamp"] },
  { id: "turnaround", displayName: "Turnaround", token: "TA", aliases: ["Turnaround", "Turn Around", "Turn"] },
  { id: "breakdown", displayName: "Breakdown", token: "BD", aliases: ["Breakdown", "Break Down"] },
  { id: "outro", displayName: "Outro", token: "O", aliases: ["Outro"] },
  { id: "ending", displayName: "Ending", token: "E", aliases: ["Ending", "End"] },
  { id: "coda", displayName: "Coda", token: "CODA", aliases: ["Coda"] },
];

/** Type id for any section whose name is not in the vocabulary. */
export const CUSTOM_TYPE_ID = "custom";

/** Case/space/hyphen-insensitive comparison key: "Pre-Chorus" → "prechorus". */
export function aliasKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildIndex(types: readonly SectionType[]): Map<string, SectionType> {
  const index = new Map<string, SectionType>();
  for (const type of types) {
    for (const name of [type.token, type.displayName, ...type.aliases]) {
      const key = aliasKey(name);
      const prior = index.get(key);
      if (prior && prior !== type) {
        throw new Error(`Section alias "${name}" belongs to both ${prior.id} and ${type.id}`);
      }
      index.set(key, type);
    }
  }
  return index;
}

const INDEX = buildIndex(SECTION_TYPES);

/** The vocabulary entry for a bare type name ("Pre Chorus", "PC", "chorus"), or undefined. */
export function findSectionType(name: string): SectionType | undefined {
  return INDEX.get(aliasKey(name));
}
