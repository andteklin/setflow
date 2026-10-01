import { classifySectionLabel } from "./sections";
import type { ParsedSong, SongSection } from "./types";

const COMMENT_RE = /^\s*\{\s*(?:comment|c)\s*:\s*(.*?)\s*\}\s*$/i;
const SONG_MAP_RE = /^\s*\{\s*x_setflow_map\s*:\s*(.*?)\s*\}\s*$/i;
// SongSelect downloads end with "CCLI Song # ...", copyright and license lines.
// WorshipTools strips this block; it must not become part of the last section.
const TRAILER_RE = /^\s*CCLI Song\s*#/i;

function trimBlankEnds(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}

function isSectionMarker(line: string): boolean {
  const comment = COMMENT_RE.exec(line);
  return comment !== null && classifySectionLabel(comment[1]) !== null;
}

/** Split off the plain-text CCLI block that follows the last section, with its leading blanks. */
function splitTrailer(lines: string[]): { body: string[]; trailer: string[] } {
  let lastMarker = -1;
  lines.forEach((line, i) => {
    if (isSectionMarker(line)) lastMarker = i;
  });
  const start = lines.findIndex((line, i) => i > lastMarker && lastMarker >= 0 && TRAILER_RE.test(line));
  if (start < 0) return { body: lines, trailer: [] };

  let gap = start;
  while (gap > lastMarker + 1 && lines[gap - 1].trim() === "") gap--;
  const trailer = lines.slice(gap);
  while (trailer.length > 0 && trailer[trailer.length - 1].trim() === "") trailer.pop();
  return { body: lines.slice(0, gap), trailer };
}

/**
 * Split ChordPro into verbatim metadata and sections. Only `{comment: ...}`
 * lines naming a known section start a new section; any other comment stays
 * in place as an annotation. Section bodies are never rewritten.
 */
export function parseChordPro(text: string): ParsedSong {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const { body, trailer } = splitTrailer(text.split(/\r?\n/));
  const metadata: string[] = [];
  const drafts: Array<Omit<SongSection, "rawLines"> & { rawLines: string[] }> = [];
  const idCounts = new Map<string, number>();
  let songMap: string | undefined;

  for (const line of body) {
    const comment = COMMENT_RE.exec(line);
    const info = comment ? classifySectionLabel(comment[1]) : null;
    if (comment && info) {
      // Identical normalized labels get distinct ids (C, C#2) rather than being merged.
      const seen = idCounts.get(info.label) ?? 0;
      idCounts.set(info.label, seen + 1);
      drafts.push({
        id: seen === 0 ? info.label : `${info.label}#${seen + 1}`,
        sourceLabel: comment[1],
        label: info.label,
        type: info.type,
        rawLines: [],
        sourceOrder: drafts.length,
      });
    } else {
      songMap ??= SONG_MAP_RE.exec(line)?.[1];
      (drafts.length > 0 ? drafts[drafts.length - 1].rawLines : metadata).push(line);
    }
  }

  return {
    eol,
    metadata: trimBlankEnds(metadata),
    sections: drafts.map((d) => Object.freeze({ ...d, rawLines: Object.freeze(trimBlankEnds(d.rawLines)) })),
    trailer,
    ...(songMap !== undefined && { songMap }),
  };
}
