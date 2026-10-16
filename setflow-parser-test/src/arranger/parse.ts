import { normalizeSectionLabel, suggestCustomTokens, type SectionClassification } from "./sections";
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

// A comment outside the vocabulary is treated as a custom section heading only
// when it is shaped like one: a short name on its own after a blank line,
// followed directly by chart lines. "Spontaneous" qualifies; "Build here"
// inside a section (no blank before it) or "Capo 2" before directives does not.
const MAX_CUSTOM_WORDS = 4;
const MAX_CUSTOM_LENGTH = 32;
const SENTENCE_PUNCTUATION_RE = /[.!?;,]/;

function looksLikeCustomHeading(lines: readonly string[], i: number, text: string): boolean {
  if (text === "" || text.length > MAX_CUSTOM_LENGTH || SENTENCE_PUNCTUATION_RE.test(text)) return false;
  if (text.split(/\s+/).length > MAX_CUSTOM_WORDS) return false;
  if (i > 0 && lines[i - 1].trim() !== "") return false;
  const next = lines[i + 1];
  return next !== undefined && next.trim() !== "" && !next.trimStart().startsWith("{");
}

/**
 * Find every section marker line. Vocabulary names always qualify; other
 * comments qualify as custom sections only if `looksLikeCustomHeading`.
 */
function detectMarkers(lines: readonly string[], customSections: boolean): Map<number, SectionClassification> {
  const markers = new Map<number, SectionClassification>();
  lines.forEach((line, i) => {
    const comment = COMMENT_RE.exec(line);
    if (!comment) return;
    const info = normalizeSectionLabel(comment[1]);
    if (info.known || (customSections && looksLikeCustomHeading(lines, i, comment[1].trim()))) {
      markers.set(i, info);
    }
  });
  return markers;
}

/** Split off the plain-text CCLI block that follows the last section, with its leading blanks. */
function splitTrailer(
  lines: string[],
  markers: ReadonlyMap<number, SectionClassification>,
): { body: string[]; trailer: string[] } {
  const lastMarker = Math.max(-1, ...markers.keys());
  const start = lines.findIndex((line, i) => i > lastMarker && lastMarker >= 0 && TRAILER_RE.test(line));
  if (start < 0) return { body: lines, trailer: [] };

  let gap = start;
  while (gap > lastMarker + 1 && lines[gap - 1].trim() === "") gap--;
  const trailer = lines.slice(gap);
  while (trailer.length > 0 && trailer[trailer.length - 1].trim() === "") trailer.pop();
  return { body: lines.slice(0, gap), trailer };
}

export interface ParseOptions {
  /**
   * Treat heading-shaped comments outside the vocabulary (e.g. "Spontaneous")
   * as custom sections. Default true; false keeps them as annotations.
   */
  customSections?: boolean;
}

/**
 * Pick a song-map token that is unique in the song. Vocabulary tokens repeat
 * as C, C#2 when the same name appears twice. A custom section never takes a
 * token the vocabulary would read as a built-in type, nor one already used.
 */
function uniqueToken(info: SectionClassification, label: string, used: Set<string>): string {
  const candidates = info.known
    ? [info.token]
    : suggestCustomTokens(label).filter((t) => !normalizeSectionLabel(t).known);
  const free = candidates.find((t) => !used.has(t));
  if (free) return free;
  const base = candidates[candidates.length - 1] ?? "SEC";
  for (let n = 2; ; n++) {
    if (!used.has(`${base}#${n}`)) return `${base}#${n}`;
  }
}

/**
 * Split ChordPro into verbatim metadata and sections. `{comment: ...}` lines
 * naming a vocabulary section (or shaped like a custom heading) start a new
 * section; any other comment stays in place as an annotation. Section bodies
 * are never rewritten, and the source label is kept exactly as written.
 */
export function parseChordPro(text: string, options: ParseOptions = {}): ParsedSong {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const allLines = text.split(/\r?\n/);
  const markers = detectMarkers(allLines, options.customSections ?? true);
  const { body, trailer } = splitTrailer(allLines, markers);
  const metadata: string[] = [];
  const drafts: Array<Omit<SongSection, "rawLines"> & { rawLines: string[] }> = [];
  const usedTokens = new Set<string>();
  let songMap: string | undefined;

  body.forEach((line, i) => {
    const info = markers.get(i);
    if (info) {
      const sourceLabel = COMMENT_RE.exec(line)![1];
      const token = uniqueToken(info, info.displayLabel, usedTokens);
      usedTokens.add(token);
      drafts.push({
        id: `sec-${drafts.length + 1}`,
        sourceLabel,
        displayLabel: info.displayLabel,
        token,
        type: info.type,
        rawLines: [],
        sourceOrder: drafts.length,
      });
    } else {
      songMap ??= SONG_MAP_RE.exec(line)?.[1];
      (drafts.length > 0 ? drafts[drafts.length - 1].rawLines : metadata).push(line);
    }
  });

  return {
    eol,
    metadata: trimBlankEnds(metadata),
    sections: drafts.map((d) => Object.freeze({ ...d, rawLines: Object.freeze(trimBlankEnds(d.rawLines)) })),
    trailer,
    ...(songMap !== undefined && { songMap }),
  };
}
