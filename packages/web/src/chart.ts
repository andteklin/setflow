import { semitoneDistance, transposeChartLine, type ChartLine, type PerformanceState, type SectionOccurrence } from "@setflow/core";
import type { LiveStatus, SessionContent } from "@setflow/server/protocol";
import { h } from "./dom";
import { largestFit } from "./fit";

export type ContentSection = SessionContent["sections"][number];

/** Semitones from the song's original key to the performance key; 0 when either is unknown. */
export function transposition(content: SessionContent | null, state: PerformanceState | null): number {
  const from = content?.metadata.originalKey;
  const to = state?.performanceKey;
  if (!from || !to) return 0;
  try {
    return semitoneDistance(from, to);
  } catch {
    return 0;
  }
}

/** "Bridge 2/3" within a repeated run, "Bridge" when played once. */
export function occurrenceText(section: ContentSection | undefined, occ: SectionOccurrence | undefined): string {
  if (!section || !occ) return "";
  return occ.repetitionCount > 1 ? `${section.sourceLabel} ${occ.repetitionIndex + 1}/${occ.repetitionCount}` : section.sourceLabel;
}

export interface LiveView {
  status: PerformanceState["status"] | "idle";
  current: { occ: SectionOccurrence; section: ContentSection } | null;
  next: { occ: SectionOccurrence; section: ContentSection } | null;
  vamping: boolean;
  /** "2/3", "2 — vamp", or "" for a single pass. */
  repetition: string;
  key: string;
  semitones: number;
}

/** Derive what every band display shows from one snapshot and its content. */
export function liveView(state: PerformanceState | null, content: SessionContent | null): LiveView {
  if (!state || !content || content.sessionId !== state.sessionId) {
    return { status: "idle", current: null, next: null, vamping: false, repetition: "", key: "", semitones: 0 };
  }
  const sections = new Map(content.sections.map((s) => [s.id, s]));
  const find = (id: string | null) => {
    const occ = state.sequence.find((o) => o.id === id);
    const section = occ && sections.get(occ.sectionId);
    return occ && section ? { occ, section } : null;
  };
  const { index, total } = state.repetition;
  return {
    status: state.status,
    current: find(state.currentOccurrenceId),
    next: find(state.nextOccurrenceId),
    vamping: state.vamping,
    repetition: state.vamping ? `${index} — vamp` : total && total > 1 ? `${index}/${total}` : "",
    key: state.performanceKey,
    semitones: transposition(content, state),
  };
}

/** What a display shows (issue #18): chords over the lyrics, or the lyrics alone. */
export type DisplayMode = "chords" | "lyrics";

export interface RenderOptions {
  /** Show `#` comment lines, dimmed. Only the MD's own views do; band displays never show them. */
  showHidden?: boolean;
  /** Default "chords". "lyrics" drops chord rows and chord-only lines. */
  mode?: DisplayMode;
}

/** Render chart lines with chords above the lyric syllable they belong to. */
export function renderLines(lines: readonly ChartLine[], semitones: number, options: RenderOptions = {}): HTMLElement {
  const mode = options.mode ?? "chords";
  const body = h("div", { class: mode === "lyrics" ? "chart lyrics-mode" : "chart" });
  let shown = 0;
  for (const raw of lines) {
    const line = transposeChartLine(raw, semitones);
    switch (line.kind) {
      case "blank":
        // Without chord lines, leave no leading or doubled gaps behind.
        if (mode === "lyrics" && (shown === 0 || body.lastElementChild?.classList.contains("chart-gap"))) break;
        body.append(h("div", { class: "chart-gap" }));
        break;
      case "comment":
        body.append(h("div", { class: "chart-note" }, line.text));
        shown++;
        break;
      case "hidden":
        if (options.showHidden) body.append(h("div", { class: "chart-hidden", title: "Hidden from Stage and Musician views" }, "# ", line.text));
        break;
      case "directive":
        break;
      case "music": {
        const el = renderMusic(line, mode);
        if (el) {
          body.append(el);
          shown++;
        }
        break;
      }
    }
  }
  if (mode === "lyrics") {
    while (body.lastElementChild?.classList.contains("chart-gap")) body.lastElementChild.remove();
    // An intro or instrumental has no words; say so rather than show an empty screen.
    if (shown === 0 && lines.length > 0) body.append(h("div", { class: "chart-note instrumental" }, "♪ Instrumental"));
  }
  return body;
}

type MusicLine = Extract<ChartLine, { kind: "music" }>;

/** A piece of a lyric line: some text, with the chord that sits over its start, if any. */
export interface Piece {
  chord: string | null;
  text: string;
}

/**
 * A line as whole words (issue #16), each a list of pieces so every chord
 * stays over its syllable. "Light the [Am]lamp be-[F]fore" becomes
 * [Light ][the ][Am:lamp ][be-, F:fore]. A line may wrap between words but
 * never inside one.
 */
export function wordPieces(line: MusicLine): Piece[][] {
  const pieces: Piece[] = [];
  const starts = [0, ...line.chords.map((c) => c.offset)];
  const chordAt = (i: number) => (i === 0 ? null : line.chords[i - 1].chord);
  starts.forEach((start, i) => {
    const end = starts[i + 1] ?? line.lyrics.length;
    const segment = line.lyrics.slice(start, end);
    if (i === 0 && segment === "") return;
    // Split the segment after each run of spaces; the chord stays on its first part.
    const parts = segment.match(/\S*\s*/g)!.filter((p, j) => p !== "" || j === 0);
    parts.forEach((text, j) => pieces.push({ chord: j === 0 ? chordAt(i) : null, text }));
  });
  const words: Piece[][] = [];
  let word: Piece[] = [];
  for (const piece of pieces) {
    word.push(piece);
    if (/\s$/.test(piece.text)) {
      words.push(word);
      word = [];
    }
  }
  if (word.length) words.push(word);
  return words;
}

/**
 * A line's lyrics for a lyrics-only display (issue #18). Hyphens the chart
 * added only to place a chord inside a word are removed, so
 * "be - [F]fore" reads "before", while a real hyphen ("well-known") stays.
 */
export function lyricText(line: MusicLine): string {
  let text = line.lyrics;
  for (const { offset } of [...line.chords].reverse()) {
    if (offset <= 0 || offset >= text.length || !/\p{L}/u.test(text[offset])) continue;
    const split = /(\p{L})\s*-\s*$/u.exec(text.slice(0, offset));
    if (split) text = text.slice(0, split.index + 1) + text.slice(offset);
  }
  // Spacing that only made room for chords (e.g. a chord over a space) is not part of the words.
  return text.replace(/\s{2,}/g, " ").trim();
}

function renderMusic(line: MusicLine, mode: DisplayMode): HTMLElement | null {
  if (mode === "lyrics") {
    const text = line.isChordOnly ? "" : lyricText(line);
    return text.trim() ? h("div", { class: "chart-line lyrics-only" }, text) : null;
  }
  if (line.chords.length === 0) return h("div", { class: "chart-line lyrics-only" }, line.lyrics);
  if (line.isChordOnly) {
    const el = h("div", { class: "chart-line chord-only" });
    const first = line.chords[0].offset;
    if (first > 0) el.append(chunk(null, line.lyrics.slice(0, first)));
    line.chords.forEach((c, i) => {
      const end = line.chords[i + 1]?.offset ?? line.lyrics.length;
      el.append(chunk(c.chord, line.lyrics.slice(c.offset, end), true));
    });
    return el;
  }
  return h(
    "div",
    { class: "chart-line" },
    wordPieces(line).map((word) => h("span", { class: "word" }, word.map((p) => chunk(p.chord, p.text)))),
  );
}

function chunk(chord: string | null, lyric: string, chordOnly = false): HTMLElement {
  const isBar = chord?.trim() === "|";
  return h(
    "span",
    { class: "chunk" },
    h("span", { class: isBar ? "chord bar" : "chord" }, chord ?? ""),
    chordOnly ? null : h("span", { class: "lyric" }, lyric),
    chordOnly && lyric.trim() === "" ? h("span", { class: "spacer" }, lyric) : null,
  );
}

/**
 * A section's lines as played at one occurrence: the section's own lines
 * with that occurrence's arrangement notes woven in (issue #9).
 */
export function occurrenceLines(content: SessionContent | null, occ: SectionOccurrence, section: ContentSection): ChartLine[] {
  const notes = content?.notes?.[occ.id];
  if (!notes?.length) return section.lines;
  const out: ChartLine[] = [];
  const at = (pos: number) => notes.filter((n) => Math.min(n.afterLine, section.lines.length) === pos).map((n) => n.line);
  out.push(...at(0));
  section.lines.forEach((line, i) => out.push(line, ...at(i + 1)));
  return out;
}

export interface ServiceView {
  /** "Song 2 of 5", or "" outside a setlist. */
  position: string;
  /** Title of the song after this one in the setlist, if any. */
  nextSong: string | null;
}

/** Where the band is in the setlist being performed (issue #7). */
export function serviceView(status: LiveStatus | null): ServiceView {
  const service = status?.service;
  if (!service) return { position: "", nextSong: null };
  return {
    position: `Song ${service.index + 1} of ${service.items.length}`,
    nextSong: service.items[service.index + 1]?.title ?? null,
  };
}

/** The first `count` lines the band would read in a section: music and notes, not gaps or hidden lines. */
export function previewLines(lines: readonly ChartLine[], count: number): ChartLine[] {
  return lines.filter((l) => l.kind === "music" || l.kind === "comment").slice(0, count);
}

/**
 * Size an element's font as large as its box allows, both ways, for
 * fixed-size stage displays (issue #13): short sections grow to fill the
 * screen, long ones shrink, never below `minPx`.
 */
export function fitText(container: HTMLElement, maxPx: number, minPx: number): void {
  const size = largestFit(minPx, maxPx, (px) => {
    container.style.fontSize = `${px}px`;
    return container.scrollHeight <= container.clientHeight + 1 && container.scrollWidth <= container.clientWidth + 1;
  });
  container.style.fontSize = `${size}px`;
}
