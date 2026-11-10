import { applyArrangement } from "./arrange.js";
import { parseChartLine } from "./chart.js";
import { normalizeSectionLabel } from "./sections.js";
import { occurrenceLabel } from "./serialize.js";
import type { ArrangementItem, ArrangementNote, ParsedSong, SongSection } from "./types.js";

/**
 * The arranged ChordPro document (issue #9): the song in performance order,
 * with the arrangement's own comment lines woven in. Source content appears
 * by reference, exactly as in the source; only comment lines belong to the
 * arrangement, so editing this document can add or remove those and nothing
 * else (spec §2.3).
 */

/** One expanded visit to an item, in performance order: item index and repetition within it. */
interface Slot {
  item: number;
  repetition: number;
  section: SongSection;
  header: string;
}

function slots(song: ParsedSong, items: readonly ArrangementItem[]): Slot[] {
  const byId = new Map(song.sections.map((s) => [s.id, s]));
  // applyArrangement expands items in this same order, so the k-th occurrence is the k-th slot.
  const occurrences = applyArrangement(song, items);
  const expanded = items.flatMap((it, item) => Array.from({ length: it.repetitions }, (_, repetition) => ({ item, repetition })));
  return expanded.map(({ item, repetition }, k) => {
    const section = byId.get(items[item].sectionId);
    if (!section) throw new Error(`Unknown section: ${items[item].sectionId}`);
    return { item, repetition, section, header: `{comment: ${occurrenceLabel(section, occurrences[k])}}` };
  });
}

/** Is this line something an arrangement may add: a ChordPro comment or a `#` hidden line? */
export function isNoteLine(line: string): boolean {
  const kind = parseChartLine(line).kind;
  return kind === "comment" || kind === "hidden";
}

/**
 * Keep the notes that still fit the arrangement: the item must exist and hold
 * the same section, and the repetition must exist. A position past the end
 * of the section (after a source edit shortened it) moves to its end.
 */
export function fitNotes(song: ParsedSong, items: readonly ArrangementItem[], notes: readonly ArrangementNote[]): ArrangementNote[] {
  const byId = new Map(song.sections.map((s) => [s.id, s]));
  return notes.flatMap((note) => {
    const item = items[note.item];
    const section = item && item.sectionId === note.sectionId ? byId.get(item.sectionId) : undefined;
    if (!section || note.repetition < 0 || note.repetition >= item.repetitions) return [];
    return [{ ...note, afterLine: Math.max(0, Math.min(section.rawLines.length, note.afterLine)) }];
  });
}

/** Notes for one slot, by the body line they follow (0 = straight after the heading). */
function notesBySlot(notes: readonly ArrangementNote[], slot: Slot): Map<number, string[]> {
  const at = new Map<number, string[]>();
  for (const n of notes) {
    if (n.item !== slot.item || n.repetition !== slot.repetition) continue;
    const pos = Math.min(n.afterLine, slot.section.rawLines.length);
    at.set(pos, [...(at.get(pos) ?? []), n.text]);
  }
  return at;
}

export interface ArrangedOptions {
  /** Recorded as `{x_setflow_map: ...}` so the chart identifies its arrangement. */
  songMap?: string;
}

/** The arranged ChordPro text: metadata, each occurrence with its notes, then any CCLI trailer. */
export function arrangedChordPro(
  song: ParsedSong,
  items: readonly ArrangementItem[],
  notes: readonly ArrangementNote[] = [],
  options: ArrangedOptions = {},
): string {
  return skeleton(song, items, options, fitNotes(song, items, notes))
    .map((l) => l.text)
    .join(song.eol) + song.eol;
}

/** A line of the arranged document. `fixed` lines come from the song; the rest are notes. */
interface DocLine {
  text: string;
  fixed: boolean;
  /** For fixed lines: where a note following this line would be anchored, or null outside any section. */
  anchor: { slot: number; afterLine: number } | null;
}

function skeleton(song: ParsedSong, items: readonly ArrangementItem[], options: ArrangedOptions, notes: readonly ArrangementNote[]): DocLine[] {
  const out: DocLine[] = song.metadata.map((text) => ({ text, fixed: true, anchor: null }));
  if (options.songMap) out.push({ text: `{x_setflow_map: ${options.songMap}}`, fixed: true, anchor: null });
  slots(song, items).forEach((slot, k) => {
    const at = notesBySlot(notes, slot);
    const pushNotes = (pos: number) => {
      for (const text of at.get(pos) ?? []) out.push({ text, fixed: false, anchor: null });
    };
    const body = slot.section.rawLines;
    // The blank before a heading still belongs to the previous occurrence.
    if (out.length > 0) out.push({ text: "", fixed: true, anchor: k > 0 ? { slot: k - 1, afterLine: Infinity } : null });
    out.push({ text: slot.header, fixed: true, anchor: { slot: k, afterLine: 0 } });
    pushNotes(0);
    body.forEach((text, j) => {
      out.push({ text, fixed: true, anchor: { slot: k, afterLine: j + 1 } });
      pushNotes(j + 1);
    });
  });
  const trailer = song.trailer;
  if (trailer.length > 0 && trailer[0].trim() !== "") out.push({ text: "", fixed: true, anchor: null });
  for (const text of trailer) out.push({ text, fixed: true, anchor: null });
  return out;
}

/** Thrown when an edited arranged document changes something other than comment lines. */
export class ArrangedEditError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(`Line ${line}: ${message}`);
  }
}

/**
 * Read the arrangement's notes back out of an edited arranged document.
 * Every song line must still be there, in order; comment lines that are not
 * song lines become notes at the place they were written. Blank lines may be
 * added or removed freely. Anything else is refused, naming the line.
 */
export function parseArrangedNotes(
  song: ParsedSong,
  items: readonly ArrangementItem[],
  edited: string,
  options: ArrangedOptions = {},
): ArrangementNote[] {
  const fixed = skeleton(song, items, options, []);
  const all = slots(song, items);
  const lines = edited.replace(/(\r?\n)+$/, "").split(/\r?\n/);
  const notes: ArrangementNote[] = [];
  let i = 0; // next expected song line
  let anchor: DocLine["anchor"] = null;

  lines.forEach((raw, n) => {
    const lineNo = n + 1;
    const text = raw.trimEnd();
    for (;;) {
      const expected = fixed[i];
      if (expected && text === expected.text.trimEnd()) {
        anchor = expected.anchor ?? (i > 0 && expected.text === "" ? anchor : null);
        i++;
        return;
      }
      if (text === "") return; // an extra blank line
      if (expected && expected.text.trim() === "") {
        i++; // a blank line the editor removed
        continue;
      }
      break;
    }
    if (!isNoteLine(text)) {
      const wanted = fixed[i]?.text;
      throw new ArrangedEditError(
        lineNo,
        wanted === undefined
          ? `“${text}” is after the end of the song. Only comments can be added here.`
          : `“${text}” changes the song itself (expected “${wanted}”). Edit chords, lyrics and sections in the ChordPro source; here you can only add or remove comments.`,
      );
    }
    if (!anchor) throw new ArrangedEditError(lineNo, "Comments must go inside a section, after its {comment: …} heading.");
    const comment = /^\s*\{\s*(?:comment|c)\s*:\s*(.*?)\s*\}\s*$/i.exec(text);
    if (comment && normalizeSectionLabel(comment[1]).known) {
      throw new ArrangedEditError(lineNo, `“${text}” would read as a section heading. Use {ci: ${comment[1]}} for a note.`);
    }
    const slot = all[anchor.slot];
    notes.push({
      item: slot.item,
      repetition: slot.repetition,
      sectionId: slot.section.id,
      afterLine: Math.min(anchor.afterLine, slot.section.rawLines.length),
      text,
    });
  });

  const missing = fixed.slice(i).find((l) => l.text.trim() !== "");
  if (missing) {
    throw new ArrangedEditError(lines.length, `“${missing.text}” is missing. Song lines can't be removed here; edit the ChordPro source or the Song Map.`);
  }
  return notes;
}

/** Notes for each planned occurrence, by occurrence index in performance order. */
export function notesByOccurrence(
  song: ParsedSong,
  items: readonly ArrangementItem[],
  notes: readonly ArrangementNote[],
): Array<Array<{ afterLine: number; text: string }>> {
  const fitted = fitNotes(song, items, notes);
  return slots(song, items).map((slot) =>
    fitted.filter((n) => n.item === slot.item && n.repetition === slot.repetition).map((n) => ({ afterLine: n.afterLine, text: n.text })),
  );
}
