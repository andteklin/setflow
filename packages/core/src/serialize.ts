import type { ParsedSong, SectionOccurrence, SongSection } from "./types.js";

/** "Bridge" when played once in a row, "Bridge 2/3" within a repeated run. */
export function occurrenceLabel(section: SongSection, occ: SectionOccurrence): string {
  return occ.repetitionCount > 1
    ? `${section.sourceLabel} ${occ.repetitionIndex + 1}/${occ.repetitionCount}`
    : section.sourceLabel;
}

export interface SerializeOptions {
  /** Recorded as `{x_setflow_map: ...}` so an arranged chart identifies itself. */
  songMap?: string;
}

/**
 * Render chronological ChordPro: original metadata, then one block per
 * occurrence, then any CCLI trailer.
 */
export function serializeChordPro(
  song: ParsedSong,
  occurrences: readonly SectionOccurrence[],
  options: SerializeOptions = {},
): string {
  const byId = new Map(song.sections.map((s) => [s.id, s]));
  const out: string[] = [...song.metadata];
  if (options.songMap) out.push(`{x_setflow_map: ${options.songMap}}`);
  for (const occ of occurrences) {
    const section = byId.get(occ.sectionId);
    if (!section) throw new Error(`Unknown section: ${occ.sectionId}`);
    if (out.length > 0) out.push("");
    out.push(`{comment: ${occurrenceLabel(section, occ)}}`, ...section.rawLines);
  }
  if (song.trailer.length > 0 && song.trailer[0].trim() !== "") out.push("");
  out.push(...song.trailer);
  return out.join(song.eol) + song.eol;
}
