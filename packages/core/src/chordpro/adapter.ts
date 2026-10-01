import ChordSheetJS, { type Song, type Line } from "chordsheetjs";

type Item = Line["items"][number];
import { classifySection, isLikelySection } from "../sections/classify.js";
import type {
  ChartLine,
  ParsedSong,
  SongAnnotation,
  SongMetadata,
  SongSection,
} from "../types.js";

/** ChordPro tag names SetFlow maps onto structured SongMetadata fields. */
const KNOWN_METADATA_TAGS: Record<string, keyof SongMetadata> = {
  title: "title",
  artist: "artist",
  key: "originalKey",
  time: "timeSignature",
  tempo: "tempo",
  ccli: "ccliNumber",
  ccli_license: "ccliLicense",
  copyright: "copyright",
  footer: "footer",
};

/** Tag names that represent structure/comments rather than metadata. */
const NON_METADATA_TAGS = new Set([
  "comment",
  "c",
  "start_of_chorus",
  "end_of_chorus",
  "start_of_verse",
  "end_of_verse",
  "start_of_bridge",
  "end_of_bridge",
  "start_of_tab",
  "end_of_tab",
  "start_of_grid",
  "end_of_grid",
]);

function extractMetadata(song: Song): SongMetadata {
  const metadata: SongMetadata = { title: "", extra: {} };

  for (const line of song.lines) {
    for (const item of line.items) {
      if (!(item instanceof ChordSheetJS.Tag)) continue;
      if (item.isComment() || item.isSectionDelimiter()) continue;

      const name = item.name;
      const value = item.value ?? "";
      const knownField = KNOWN_METADATA_TAGS[name];

      if (knownField === "tempo") {
        const parsedTempo = Number.parseInt(value, 10);
        if (!Number.isNaN(parsedTempo)) metadata.tempo = parsedTempo;
      } else if (knownField) {
        (metadata as unknown as Record<string, unknown>)[knownField] = value;
      } else if (!NON_METADATA_TAGS.has(name)) {
        metadata.extra[name] = value;
      }
    }
  }

  return metadata;
}

function lineToChartLine(items: Item[]): ChartLine | null {
  const pairs = items.filter(
    (item): item is InstanceType<typeof ChordSheetJS.ChordLyricsPair> =>
      item instanceof ChordSheetJS.ChordLyricsPair,
  );
  if (pairs.length === 0) return null;

  let lyrics = "";
  const chords: ChartLine["chords"] = [];

  for (const pair of pairs) {
    if (pair.chords) {
      chords.push({ offset: lyrics.length, chord: pair.chords });
    }
    lyrics += pair.lyrics ?? "";
  }

  return {
    lyrics,
    chords,
    isChordOnly: lyrics.trim().length === 0,
  };
}

let sectionCounter = 0;
let annotationCounter = 0;

function makeSection(sourceLabel: string, sourceOrder: number): SongSection {
  const { type, label } = classifySection(sourceLabel);
  return {
    id: `sec-${sourceOrder}-${sectionCounter++}`,
    sourceLabel,
    label,
    type,
    lines: [],
    sourceOrder,
  };
}

/**
 * Converts raw ChordPro source into SetFlow's internal song model.
 * Delegates tokenization/metadata/chord parsing to ChordSheetJS (per spec
 * section 18) but builds SetFlow's own section/annotation structure on top
 * rather than depending on the library's rendering model.
 */
export function importChordPro(source: string): ParsedSong {
  const parser = new ChordSheetJS.ChordProParser();
  const song = parser.parse(source);

  const metadata = extractMetadata(song);
  const sections: SongSection[] = [];
  const annotations: SongAnnotation[] = [];

  // `sections` (the finished list) and `open` (the section currently being
  // filled) are tracked as array + index rather than a nullable variable
  // reassigned from inline branches -- TypeScript's control-flow narrowing
  // doesn't follow reassignments across the multiple branches below closely
  // enough to keep a `let x: T | null` reliably narrowed here.
  let currentSourceOrder = -1;
  let nextSourceOrder = 0;

  for (const line of song.lines) {
    const commentTag = line.items.find(
      (item): item is InstanceType<typeof ChordSheetJS.Tag> =>
        item instanceof ChordSheetJS.Tag && item.isComment(),
    );

    if (commentTag) {
      const text = commentTag.value ?? "";
      if (isLikelySection(text)) {
        sections.push(makeSection(text, nextSourceOrder));
        currentSourceOrder = nextSourceOrder;
        nextSourceOrder++;
      } else {
        annotations.push({
          id: `ann-${annotationCounter++}`,
          text,
          afterSectionOrder: currentSourceOrder,
        });
      }
      continue;
    }

    const sectionTag = line.items.find(
      (item): item is InstanceType<typeof ChordSheetJS.Tag> =>
        item instanceof ChordSheetJS.Tag && item.isSectionStart(),
    );
    if (sectionTag) {
      const label = sectionTag.attributes.label ?? sectionTag.label ?? sectionTag.name;
      sections.push(makeSection(label, nextSourceOrder));
      currentSourceOrder = nextSourceOrder;
      nextSourceOrder++;
      continue;
    }

    const chartLine = lineToChartLine(line.items);
    if (!chartLine) continue;

    if (sections.length === 0) {
      sections.push(makeSection("", nextSourceOrder));
      currentSourceOrder = nextSourceOrder;
      nextSourceOrder++;
    }
    sections[sections.length - 1].lines.push(chartLine);
  }

  return { metadata, sections, annotations, originalChordPro: source };
}
