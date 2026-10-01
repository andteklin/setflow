import { classifySectionLabel } from "./sections";
import type { ParsedSong, SongSection } from "./types";

const COMMENT_RE = /^\s*\{\s*(?:comment|c)\s*:\s*(.*?)\s*\}\s*$/i;

function trimBlankEnds(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}

/**
 * Split ChordPro into verbatim metadata and sections. Only `{comment: ...}`
 * lines naming a known section start a new section; any other comment stays
 * in place as an annotation. Section bodies are never rewritten.
 */
export function parseChordPro(text: string): ParsedSong {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const metadata: string[] = [];
  const drafts: Array<Omit<SongSection, "rawLines"> & { rawLines: string[] }> = [];
  const idCounts = new Map<string, number>();

  for (const line of text.split(/\r?\n/)) {
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
      (drafts.length > 0 ? drafts[drafts.length - 1].rawLines : metadata).push(line);
    }
  }

  return {
    eol,
    metadata: trimBlankEnds(metadata),
    sections: drafts.map((d) => Object.freeze({ ...d, rawLines: Object.freeze(trimBlankEnds(d.rawLines)) })),
  };
}
