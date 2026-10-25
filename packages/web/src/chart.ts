import { semitoneDistance, transposeChartLine, type ChartLine, type PerformanceState, type SectionOccurrence } from "@setflow/core";
import type { SessionContent } from "@setflow/server/protocol";
import { h } from "./dom";

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

/** Render chart lines with chords above the lyric syllable they belong to. */
export function renderLines(lines: readonly ChartLine[], semitones: number): HTMLElement {
  const body = h("div", { class: "chart" });
  for (const raw of lines) {
    const line = transposeChartLine(raw, semitones);
    switch (line.kind) {
      case "blank":
        body.append(h("div", { class: "chart-gap" }));
        break;
      case "comment":
        body.append(h("div", { class: "chart-note" }, line.text));
        break;
      case "directive":
        break;
      case "music":
        body.append(renderMusic(line));
        break;
    }
  }
  return body;
}

function renderMusic(line: Extract<ChartLine, { kind: "music" }>): HTMLElement {
  if (line.chords.length === 0) return h("div", { class: "chart-line lyrics-only" }, line.lyrics);
  const el = h("div", { class: line.isChordOnly ? "chart-line chord-only" : "chart-line" });
  const first = line.chords[0].offset;
  if (first > 0) el.append(chunk(null, line.lyrics.slice(0, first)));
  line.chords.forEach((c, i) => {
    const end = line.chords[i + 1]?.offset ?? line.lyrics.length;
    el.append(chunk(c.chord, line.lyrics.slice(c.offset, end), line.isChordOnly));
  });
  return el;
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

/** Shrink an element's font until its content fits both ways, for fixed-size stage displays. */
export function fitText(container: HTMLElement, maxPx: number, minPx: number): void {
  let size = maxPx;
  container.style.fontSize = `${size}px`;
  const overflows = () =>
    container.scrollHeight > container.clientHeight + 1 || container.scrollWidth > container.clientWidth + 1;
  while (size > minPx && overflows()) {
    size = Math.max(minPx, Math.floor(size * 0.93));
    container.style.fontSize = `${size}px`;
  }
}
