import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { importChordPro } from "../src/chordpro/adapter.js";
import {
  createSourceOrderArrangement,
  generatePerformanceSequence,
} from "../src/arrangement/engine.js";
import { transposeChord, transposeSection, semitoneDistance } from "../src/chords/transpose.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(
  path.join(__dirname, "fixtures/sample-variants.cho"),
  "utf8",
);

describe("importChordPro — MVP acceptance test (spec section 30)", () => {
  const song = importChordPro(fixture);

  it("reads the metadata", () => {
    expect(song.metadata.title).toBe("Morning Lantern (Example)");
    expect(song.metadata.originalKey).toBe("C");
    expect(song.metadata.tempo).toBe(84);
    expect(song.metadata.timeSignature).toBe("4/4");
    expect(song.metadata.ccliNumber).toBe("7654321");
    expect(song.metadata.ccliLicense).toBe("1234567");
    expect(song.metadata.artist).toContain("SetFlow Example");
    expect(song.metadata.copyright).toContain("Example Music");
    expect(song.metadata.footer).toContain("SongSelect");
  });

  it("detects all ten sections and preserves their original names", () => {
    expect(song.sections).toHaveLength(10);
    expect(song.sections.map((s) => s.sourceLabel)).toEqual([
      "Intro",
      "Verse 1",
      "Chorus 1a",
      "Instrumental",
      "Verse 2",
      "Chorus 1b",
      "Bridge",
      "Chorus 1c",
      "Chorus 1d",
      "Ending",
    ]);
  });

  it("classifies section types and normalized labels", () => {
    expect(song.sections.map((s) => [s.type, s.label])).toEqual([
      ["intro", "I"],
      ["verse", "V1"],
      ["chorus", "C1A"],
      ["instrumental", "INST"],
      ["verse", "V2"],
      ["chorus", "C1B"],
      ["bridge", "B"],
      ["chorus", "C1C"],
      ["chorus", "C1D"],
      ["ending", "E"],
    ]);
  });

  it("treats near-identical chorus variants as distinct sections (spec section 8)", () => {
    const choruses = song.sections.filter((s) => s.type === "chorus");
    const ids = new Set(choruses.map((c) => c.id));
    expect(ids.size).toBe(4);

    const c1a = song.sections.find((s) => s.sourceLabel === "Chorus 1a")!;
    const c1b = song.sections.find((s) => s.sourceLabel === "Chorus 1b")!;
    expect(c1a.lines).not.toEqual(c1b.lines);
  });

  it("preserves chord-only Intro/Instrumental content", () => {
    const intro = song.sections.find((s) => s.sourceLabel === "Intro")!;
    expect(intro.lines).toHaveLength(1);
    expect(intro.lines[0].isChordOnly).toBe(true);
    expect(intro.lines[0].chords.map((c) => c.chord)).toEqual([
      "|",
      "Am",
      "F",
      "|",
      "C",
      "|",
      "Am",
      "F",
      "|",
      "C",
      "|",
    ]);

    const instrumental = song.sections.find((s) => s.sourceLabel === "Instrumental")!;
    expect(instrumental.lines[0].isChordOnly).toBe(true);
  });

  it("keeps lyric lines and chord placements separate but positionally linked", () => {
    const verse1 = song.sections.find((s) => s.sourceLabel === "Verse 1")!;
    const firstLine = verse1.lines[0];
    expect(firstLine.isChordOnly).toBe(false);
    expect(firstLine.lyrics).not.toMatch(/[[\]]/); // brackets stripped from lyrics
    expect(firstLine.chords.length).toBeGreaterThan(0);
    for (const placement of firstLine.chords) {
      expect(placement.offset).toBeGreaterThanOrEqual(0);
      expect(placement.offset).toBeLessThanOrEqual(firstLine.lyrics.length);
    }
  });

  it("preserves slash chords (G/B, C/E) verbatim in the parsed model", () => {
    const chorus1a = song.sections.find((s) => s.sourceLabel === "Chorus 1a")!;
    const allChords = chorus1a.lines.flatMap((l) => l.chords.map((c) => c.chord));
    expect(allChords).toContain("G/B");

    const bridge = song.sections.find((s) => s.sourceLabel === "Bridge")!;
    const bridgeChords = bridge.lines.flatMap((l) => l.chords.map((c) => c.chord));
    expect(bridgeChords).toContain("C/E");
  });

  it("preserves the original ChordPro source untouched", () => {
    expect(song.originalChordPro).toBe(fixture);
  });

  it("creates a Source Order arrangement automatically", () => {
    const arrangement = createSourceOrderArrangement(song, "morning-lantern");
    expect(arrangement.name).toBe("Source Order");
    expect(arrangement.items.map((i) => i.sectionId)).toEqual(
      song.sections.map((s) => s.id),
    );
    expect(arrangement.items.every((i) => i.repetitions === 1)).toBe(true);
  });

  it("generates a chronological performance sequence with repeated references", () => {
    const bridge = song.sections.find((s) => s.sourceLabel === "Bridge")!;
    const chorus = song.sections.find((s) => s.sourceLabel === "Chorus 1a")!;

    const arrangement = createSourceOrderArrangement(song, "morning-lantern");
    arrangement.items = [
      { sectionId: bridge.id, repetitions: 3 },
      { sectionId: chorus.id, repetitions: 1 },
    ];

    const sequence = generatePerformanceSequence(arrangement);
    expect(sequence).toHaveLength(4);
    expect(sequence.slice(0, 3)).toEqual([
      { sectionId: bridge.id, occurrenceIndex: 0, repetitionIndex: 0, repetitionCount: 3 },
      { sectionId: bridge.id, occurrenceIndex: 1, repetitionIndex: 1, repetitionCount: 3 },
      { sectionId: bridge.id, occurrenceIndex: 2, repetitionIndex: 2, repetitionCount: 3 },
    ]);
    expect(sequence[3]).toEqual({
      sectionId: chorus.id,
      occurrenceIndex: 3,
      repetitionIndex: 0,
      repetitionCount: 1,
    });
  });

  it("transposes chords including slash chords without touching lyrics or structure", () => {
    const bridge = song.sections.find((s) => s.sourceLabel === "Bridge")!;
    const semitones = semitoneDistance("C", "D");
    expect(semitones).toBe(2);

    const transposed = transposeSection(bridge, semitones);
    expect(transposed.sourceLabel).toBe(bridge.sourceLabel);
    expect(transposed.lines.map((l) => l.lyrics)).toEqual(bridge.lines.map((l) => l.lyrics));

    const transposedChords = transposed.lines.flatMap((l) => l.chords.map((c) => c.chord));
    expect(transposedChords).toContain("D/F#"); // C/E -> D/F#
    expect(transposeChord("Am", 2)).toBe("Bm");
    expect(transposeChord("G", 2)).toBe("A");
  });
});

describe("importChordPro — unknown/custom sections (spec section 5.4, 6)", () => {
  it("classifies an unrecognized short label as a custom section", () => {
    const source = `{title: Test}\n{comment: Breakdown}\n[C]hello [G]world\n`;
    const song = importChordPro(source);
    expect(song.sections).toHaveLength(1);
    expect(song.sections[0].type).toBe("custom");
    expect(song.sections[0].sourceLabel).toBe("Breakdown");
  });

  it("preserves a performance note as an annotation instead of a section", () => {
    const source = `{title: Test}\n{comment: Verse 1}\n[C]hello\n{comment: Acoustic guitar only}\n[C]world\n`;
    const song = importChordPro(source);
    expect(song.sections).toHaveLength(1);
    expect(song.annotations).toHaveLength(1);
    expect(song.annotations[0].text).toBe("Acoustic guitar only");
  });

  it("does not fail on unknown metadata directives and preserves them", () => {
    const source = `{title: Test}\n{capo: 2}\n{comment: Verse 1}\n[C]hello\n`;
    const song = importChordPro(source);
    expect(song.metadata.extra.capo).toBe("2");
  });
});
