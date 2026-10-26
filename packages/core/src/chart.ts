import type { ChartLine, ChordPlacement, ParsedSong, SongMetadata, SongSection } from "./types.js";

const DIRECTIVE_RE = /^\s*\{\s*([A-Za-z_][\w-]*)\s*(?::\s*(.*?))?\s*\}\s*$/;
const CHORD_RE = /\[([^\]]*)\]/g;
const COMMENT_NAMES = new Set(["comment", "c", "comment_italic", "ci", "comment_box", "cb"]);

/** Directive names mapped onto structured fields. Everything else lands in `extra`. */
const KNOWN_FIELDS: Record<string, Exclude<keyof SongMetadata, "extra" | "tempo">> = {
  title: "title",
  t: "title",
  artist: "artist",
  key: "originalKey",
  time: "timeSignature",
  ccli: "ccliNumber",
  ccli_license: "ccliLicense",
  copyright: "copyright",
  footer: "footer",
};

/** Read the structured metadata out of the song's verbatim header lines. Unknown directives never fail. */
export function songMetadata(song: ParsedSong): SongMetadata {
  const metadata: SongMetadata = { title: "", extra: {} };
  for (const line of song.metadata) {
    const m = DIRECTIVE_RE.exec(line);
    if (!m) continue;
    const name = m[1].toLowerCase();
    const value = m[2] ?? "";
    if (COMMENT_NAMES.has(name)) continue;
    if (name === "tempo") {
      const tempo = Number.parseFloat(value);
      if (Number.isFinite(tempo)) metadata.tempo = tempo;
      else metadata.extra[name] = value;
    } else if (KNOWN_FIELDS[name]) {
      metadata[KNOWN_FIELDS[name]] = value;
    } else {
      metadata.extra[name] = value;
    }
  }
  return metadata;
}

/** Split one ChordPro body line into lyrics and positioned chords, e.g. for rendering or transposing. */
export function parseChartLine(raw: string): ChartLine {
  if (raw.trim() === "") return { kind: "blank" };
  const directive = DIRECTIVE_RE.exec(raw);
  if (directive) {
    const name = directive[1].toLowerCase();
    const value = directive[2] ?? "";
    return COMMENT_NAMES.has(name) ? { kind: "comment", text: value } : { kind: "directive", name, value };
  }

  const chords: ChordPlacement[] = [];
  let lyrics = "";
  let last = 0;
  for (const m of raw.matchAll(CHORD_RE)) {
    lyrics += raw.slice(last, m.index);
    chords.push({ offset: lyrics.length, chord: m[1] });
    last = m.index + m[0].length;
  }
  lyrics += raw.slice(last);
  return { kind: "music", lyrics, chords, isChordOnly: chords.length > 0 && lyrics.trim() === "" };
}

/** A section's body as chart lines. The section itself is not changed. */
export function chartLines(section: SongSection): ChartLine[] {
  return section.rawLines.map(parseChartLine);
}
