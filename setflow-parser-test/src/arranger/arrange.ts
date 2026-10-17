import type { ArrangementItem, ParsedSong, SectionOccurrence } from "./types";

/** Default arrangement: every section once, in source order (spec §10). */
export function sourceOrderArrangement(song: ParsedSong): ArrangementItem[] {
  return song.sections.map((s) => ({ sectionId: s.id, repetitions: 1 }));
}

/**
 * Expand an arrangement into section occurrences. Section definitions are only
 * referenced, never copied or changed. Repetition counters describe the
 * contiguous run of a section, so `B*2` and `B,B` both yield Bridge 1/2, 2/2.
 */
export function applyArrangement(
  song: ParsedSong,
  arrangement: readonly ArrangementItem[],
): SectionOccurrence[] {
  const known = new Set(song.sections.map((s) => s.id));
  const flat: string[] = [];
  for (const item of arrangement) {
    if (!known.has(item.sectionId)) throw new Error(`Unknown section: ${item.sectionId}`);
    if (!Number.isInteger(item.repetitions) || item.repetitions < 1) {
      throw new Error(`Invalid repetition count for ${item.sectionId}: ${item.repetitions}`);
    }
    for (let i = 0; i < item.repetitions; i++) flat.push(item.sectionId);
  }

  const occurrences: SectionOccurrence[] = [];
  for (let start = 0; start < flat.length; ) {
    let end = start;
    while (end < flat.length && flat[end] === flat[start]) end++;
    for (let i = start; i < end; i++) {
      occurrences.push({
        id: `occ-${i + 1}`,
        sectionId: flat[i],
        occurrenceIndex: i,
        repetitionIndex: i - start,
        repetitionCount: end - start,
      });
    }
    start = end;
  }
  return occurrences;
}
