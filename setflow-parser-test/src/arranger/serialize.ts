import type { ParsedSong, SectionOccurrence, SongSection } from "./types";

/** "Bridge" when played once in a row, "Bridge 2/3" within a repeated run. */
export function occurrenceLabel(section: SongSection, occ: SectionOccurrence): string {
  return occ.repetitionCount > 1
    ? `${section.sourceLabel} ${occ.repetitionIndex + 1}/${occ.repetitionCount}`
    : section.sourceLabel;
}

/** Render chronological ChordPro: original metadata, then one block per occurrence. */
export function serializeChordPro(
  song: ParsedSong,
  occurrences: readonly SectionOccurrence[],
): string {
  const byId = new Map(song.sections.map((s) => [s.id, s]));
  const out: string[] = [...song.metadata];
  for (const occ of occurrences) {
    const section = byId.get(occ.sectionId);
    if (!section) throw new Error(`Unknown section: ${occ.sectionId}`);
    if (out.length > 0) out.push("");
    out.push(`{comment: ${occurrenceLabel(section, occ)}}`, ...section.rawLines);
  }
  return out.join(song.eol) + song.eol;
}
