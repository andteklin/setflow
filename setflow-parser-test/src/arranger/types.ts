export type SectionType =
  | "intro"
  | "verse"
  | "prechorus"
  | "chorus"
  | "bridge"
  | "instrumental"
  | "interlude"
  | "tag"
  | "ending"
  | "outro";

/** A section *definition*: reusable content, never mutated after parsing. */
export interface SongSection {
  /** Unique within the song. Usually the normalized label (e.g. "C1A"). */
  id: string;
  /** Label exactly as written in the source, e.g. "Chorus 1a". */
  sourceLabel: string;
  /** Normalized label, e.g. "C1A". */
  label: string;
  type: SectionType;
  /** Body lines exactly as in the source (chords, bars, annotations, inner blanks). */
  rawLines: readonly string[];
  sourceOrder: number;
}

export interface ParsedSong {
  /** Line ending detected in the source ("\n" or "\r\n"). */
  eol: string;
  /** Everything before the first section marker, verbatim (title, key, unknown directives...). */
  metadata: readonly string[];
  sections: readonly SongSection[];
  /** Plain-text CCLI block after the last section in SongSelect downloads, verbatim. */
  trailer: readonly string[];
  /** Song map recorded by a previous SetFlow arrangement (`{x_setflow_map: ...}`). */
  songMap?: string;
}

export interface ArrangementItem {
  sectionId: string;
  repetitions: number;
}

/** A section *occurrence*: one visit to a section definition in an arrangement. */
export interface SectionOccurrence {
  id: string;
  sectionId: string;
  /** Position in the arranged sequence (0-based). */
  occurrenceIndex: number;
  /** Position within the contiguous run of this section (0-based). */
  repetitionIndex: number;
  /** Length of the contiguous run of this section. */
  repetitionCount: number;
}
