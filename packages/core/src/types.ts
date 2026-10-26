/**
 * A section *definition*: reusable content, never mutated after parsing.
 *
 * Four things are kept apart: `id` (identity), `sourceLabel` (what the chart
 * said), `type` (classification) and `token` (the short song-map name). The
 * token is a label for people; nothing should be keyed on it except song-map
 * text, and two sections of the same type never share content or identity.
 */
export interface SongSection {
  /** Opaque identity, unique within the song and independent of the label or token. */
  id: string;
  /** Label exactly as written in the source, e.g. "Pre Chorus". Never rewritten. */
  sourceLabel: string;
  /** Readable normalized label, e.g. "Chorus 1A"; the source text for custom sections. */
  displayLabel: string;
  /** Short song-map name, unique within the song, e.g. "C1A", "PC", or "BC" for a custom "Big Chorus". */
  token: string;
  /** Vocabulary type id (see sectionTypes.ts), or "custom" when the name is not in it. */
  type: string;
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
  /** "planned" when expanded from a saved arrangement, "live" when inserted during performance. */
  origin: "planned" | "live";
  sectionId: string;
  /** Position in the arranged sequence (0-based). */
  occurrenceIndex: number;
  /** Position within the contiguous run of this section (0-based). */
  repetitionIndex: number;
  /** Length of the contiguous run of this section. */
  repetitionCount: number;
}

/** Structured view of the common metadata directives (spec §4). The verbatim lines stay in `ParsedSong.metadata`. */
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
  /** Every other directive, by name, e.g. `{capo: 2}` → `{ capo: "2" }`. */
  extra: Record<string, string>;
}

/** One chord anchored at a character offset into `ChartLine.lyrics`. */
export interface ChordPlacement {
  offset: number;
  /** Chord exactly as written, e.g. "G/B", or "|" for a bar marker. */
  chord: string;
}

/** A section body line split into renderable parts. Derived from `rawLines`, never stored instead of them. */
export type ChartLine =
  | { kind: "music"; lyrics: string; chords: ChordPlacement[]; isChordOnly: boolean }
  | { kind: "comment"; text: string }
  | { kind: "directive"; name: string; value: string }
  | { kind: "blank" };
