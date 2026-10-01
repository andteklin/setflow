export interface SongMetadata {
  title: string;
  artist?: string;
  originalKey?: string;
  timeSignature?: string;
  tempo?: number;
  ccliNumber?: string;
  ccliLicense?: string;
  copyright?: string;
  footer?: string;
  /**
   * Any metadata directive SetFlow doesn't map to a structured field
   * (e.g. {capo: ...}), preserved verbatim so import -> export doesn't
   * lose information.
   */
  extra: Record<string, string>;
}

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
  | "outro"
  | "custom";

/** One chord placed at a character offset within a lyric/chord line. */
export interface ChordPlacement {
  /** Character offset into ChartLine.lyrics where this chord is anchored. */
  offset: number;
  /** Chord exactly as written in the source (e.g. "G/B", "Am7"). */
  chord: string;
}

/**
 * A single line of chart content. `lyrics` holds the line's text with all
 * inline chord brackets stripped out; `chords` records where each chord
 * belonged so the two can be re-combined for rendering or transposition
 * without one clobbering the other.
 */
export interface ChartLine {
  lyrics: string;
  chords: ChordPlacement[];
  /** True for lines that carry no lyric text at all (e.g. instrumental bars). */
  isChordOnly: boolean;
}

/**
 * A structural comment (or other freeform note) that SetFlow could not
 * confidently classify as a section boundary. Preserved rather than
 * discarded so the user can promote it to a section later.
 */
export interface SongAnnotation {
  id: string;
  text: string;
  /** sourceOrder of the section this annotation immediately precedes/follows. */
  afterSectionOrder: number;
}

export interface SongSection {
  id: string;

  // Source identity
  sourceLabel: string;

  // Normalized SetFlow representation
  label: string;
  type: SectionType;

  lines: ChartLine[];

  sourceOrder: number;
}

export interface ParsedSong {
  metadata: SongMetadata;
  sections: SongSection[];
  annotations: SongAnnotation[];
  /** The untouched ChordPro text as imported, kept for editing/export/reparsing. */
  originalChordPro: string;
}

export interface ArrangementItem {
  sectionId: string;
  repetitions: number;
}

export interface Arrangement {
  id: string;
  songId: string;
  name: string;
  items: ArrangementItem[];
}

export interface SectionOccurrence {
  sectionId: string;
  /** Position of this occurrence within the full performance sequence (0-based). */
  occurrenceIndex: number;
  /** Which repetition of its arrangement item this is (0-based). */
  repetitionIndex: number;
  /** Total repetitions requested for this arrangement item. */
  repetitionCount: number;
}

export const SOURCE_ORDER_ARRANGEMENT_NAME = "Source Order";
