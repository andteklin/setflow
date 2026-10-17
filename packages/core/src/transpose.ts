import ChordSheetJS from "chordsheetjs";
import type { ChartLine } from "./types.js";

/**
 * Transpose one chord symbol (e.g. "G/B", "Am7") by a number of semitones.
 * Tokens that aren't chords, such as bar markers ("|"), pass through unchanged.
 */
export function transposeChord(chord: string, semitones: number): string {
  if (semitones % 12 === 0 || !chord) return chord;
  try {
    return ChordSheetJS.Chord.parse(chord)?.transpose(semitones).toString() ?? chord;
  } catch {
    return chord;
  }
}

/** Transpose the chords of a chart line. Lyrics, comments and directives are untouched. */
export function transposeChartLine(line: ChartLine, semitones: number): ChartLine {
  if (line.kind !== "music" || semitones % 12 === 0) return line;
  return { ...line, chords: line.chords.map((c) => ({ ...c, chord: transposeChord(c.chord, semitones) })) };
}

const NOTE_SEMITONES: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6,
  Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

function keyToSemitone(key: string): number {
  const m = /^([A-Ga-g])([#b]?)/.exec(key.trim());
  const semitone = m ? NOTE_SEMITONES[m[1].toUpperCase() + m[2]] : undefined;
  if (semitone === undefined) throw new Error(`Unrecognized key: "${key}"`);
  return semitone;
}

/** Semitones from `fromKey` up to `toKey` (0–11). Only the root matters: "Am" → "Bm" is 2. */
export function semitoneDistance(fromKey: string, toKey: string): number {
  return (keyToSemitone(toKey) - keyToSemitone(fromKey) + 12) % 12;
}
