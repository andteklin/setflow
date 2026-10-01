import ChordSheetJS from "chordsheetjs";
import type { ChartLine, SongSection } from "../types.js";

/**
 * Transposes a single chord symbol (e.g. "G/B", "Am7") by a number of
 * semitones using ChordSheetJS's chord theory, per spec section 18: the
 * external library may handle transposition, but SetFlow owns the
 * surrounding model. Tokens that aren't real chords (bar markers like "|")
 * pass through unchanged instead of throwing.
 */
export function transposeChord(chord: string, semitones: number): string {
  if (semitones === 0 || !chord) return chord;
  try {
    const parsed = ChordSheetJS.Chord.parse(chord);
    if (!parsed) return chord;
    return parsed.transpose(semitones).toString();
  } catch {
    return chord;
  }
}

export function transposeChartLine(line: ChartLine, semitones: number): ChartLine {
  if (semitones === 0) return line;
  return {
    ...line,
    chords: line.chords.map((placement) => ({
      ...placement,
      chord: transposeChord(placement.chord, semitones),
    })),
  };
}

export function transposeSection(section: SongSection, semitones: number): SongSection {
  if (semitones === 0) return section;
  return {
    ...section,
    lines: section.lines.map((line) => transposeChartLine(line, semitones)),
  };
}

const NOTE_SEMITONES: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

/**
 * Number of semitones from `fromKey` up to `toKey` (0-11), ignoring
 * major/minor quality -- only the root pitch matters for transposition
 * distance. Throws on a key SetFlow doesn't recognize as a note name.
 */
export function semitoneDistance(fromKey: string, toKey: string): number {
  const from = keyToSemitone(fromKey);
  const to = keyToSemitone(toKey);
  return (to - from + 12) % 12;
}

function keyToSemitone(key: string): number {
  const match = key.trim().match(/^([A-Ga-g])([#b]?)/);
  if (!match) {
    throw new Error(`Unrecognized key: "${key}"`);
  }
  const note = match[1].toUpperCase() + match[2];
  const semitone = NOTE_SEMITONES[note];
  if (semitone === undefined) {
    throw new Error(`Unrecognized key: "${key}"`);
  }
  return semitone;
}
