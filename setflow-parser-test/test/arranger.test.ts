import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  applyArrangement,
  classifySectionLabel,
  occurrenceLabel,
  parseChordPro,
  parseSongMap,
  serializeChordPro,
  sourceOrderArrangement,
  type ParsedSong,
} from "../src/arranger";

const FIXTURE = fs.readFileSync(path.join(__dirname, "../src/sample-variants.cho"), "utf8");

function arrange(source: string, map?: string): string {
  const song = parseChordPro(source);
  const items = map ? parseSongMap(map, song) : sourceOrderArrangement(song);
  return serializeChordPro(song, applyArrangement(song, items));
}

function labels(song: ParsedSong, map: string): string[] {
  const byId = new Map(song.sections.map((s) => [s.id, s]));
  return applyArrangement(song, parseSongMap(map, song)).map((o) =>
    occurrenceLabel(byId.get(o.sectionId)!, o),
  );
}

describe("section labels", () => {
  it("normalizes spec §5.3 examples", () => {
    const cases: Array<[string, string, string]> = [
      ["Intro", "intro", "I"],
      ["Verse 1", "verse", "V1"],
      ["Pre-Chorus", "prechorus", "PC"],
      ["Chorus", "chorus", "C"],
      ["Chorus 1a", "chorus", "C1A"],
      ["Bridge 2", "bridge", "B2"],
      ["Instrumental", "instrumental", "INST"],
      ["Interlude", "interlude", "INT"],
      ["Tag", "tag", "T"],
      ["Ending", "ending", "E"],
      ["Outro", "outro", "O"],
    ];
    for (const [raw, type, label] of cases) {
      assert.deepEqual(classifySectionLabel(raw), { type, label }, raw);
    }
  });

  it("ignores a generated repeat counter", () => {
    assert.deepEqual(classifySectionLabel("Chorus 1c 2/2"), { type: "chorus", label: "C1C" });
  });

  it("does not treat performance notes as sections", () => {
    assert.equal(classifySectionLabel("Build here"), null);
    assert.equal(classifySectionLabel("Acoustic guitar only"), null);
  });
});

describe("Morning Lantern sample (chorus variants)", () => {
  const song = parseChordPro(FIXTURE);

  it("detects all ten sections in source order with source labels preserved", () => {
    assert.deepEqual(
      song.sections.map((s) => [s.id, s.type, s.sourceLabel]),
      [
        ["I", "intro", "Intro"],
        ["V1", "verse", "Verse 1"],
        ["C1A", "chorus", "Chorus 1a"],
        ["INST", "instrumental", "Instrumental"],
        ["V2", "verse", "Verse 2"],
        ["C1B", "chorus", "Chorus 1b"],
        ["B", "bridge", "Bridge"],
        ["C1C", "chorus", "Chorus 1c"],
        ["C1D", "chorus", "Chorus 1d"],
        ["E", "ending", "Ending"],
      ],
    );
  });

  it("keeps all metadata directives verbatim, including unknown ones", () => {
    assert.equal(song.metadata.length, 9);
    assert.equal(song.metadata[0], "{title: Morning Lantern (Example)}");
    assert.ok(song.metadata.some((l) => l.startsWith("{ccli_license: 1234567}")));
    assert.ok(song.metadata.some((l) => l.startsWith("{footer: For use solely")));
  });

  it("keeps chorus variants distinct", () => {
    const choruses = song.sections.filter((s) => s.type === "chorus");
    const bodies = new Set(choruses.map((s) => s.rawLines.join("\n")));
    assert.equal(choruses.length, 4);
    assert.equal(bodies.size, 4);
  });

  it("preserves chord-only bar lines and slash chords byte-for-byte", () => {
    const sourceLines = FIXTURE.split(/\r?\n/);
    const intro = song.sections.find((s) => s.id === "I")!;
    assert.deepEqual(intro.rawLines, [sourceLines[11]]);
    const bridge = song.sections.find((s) => s.id === "B")!;
    assert.ok(bridge.rawLines[2].includes("[C/E]"));
    assert.deepEqual(bridge.rawLines, sourceLines.slice(37, 40));
  });

  it("round-trips the source order arrangement to the original file", () => {
    assert.equal(arrange(FIXTURE), FIXTURE.trimEnd() + song.eol);
  });

  it("refuses to guess which chorus variant a bare C means", () => {
    assert.throws(
      () => parseSongMap("V1,C,V2", song),
      /Unknown section "C"\. Did you mean: C1A, C1B, C1C, C1D\?/,
    );
  });

  it("expands the §30.2 map into chronological occurrences", () => {
    assert.deepEqual(labels(song, "I,V1,C1A,V2,C1B,B*2,C1C*2,E"), [
      "Intro",
      "Verse 1",
      "Chorus 1a",
      "Verse 2",
      "Chorus 1b",
      "Bridge 1/2",
      "Bridge 2/2",
      "Chorus 1c 1/2",
      "Chorus 1c 2/2",
      "Ending",
    ]);
  });

  it("generates occurrences without copying or mutating section definitions", () => {
    const before = structuredClone(song.sections);
    const occurrences = applyArrangement(song, parseSongMap("B*4", song));
    assert.equal(occurrences.length, 4);
    assert.equal(new Set(occurrences.map((o) => o.id)).size, 4);
    assert.ok(occurrences.every((o) => o.sectionId === "B"));
    assert.deepEqual(song.sections, before);
    assert.ok(Object.isFrozen(song.sections[0].rawLines));
  });

  it("writes arranged output whose sections reparse to the same content", () => {
    const out = arrange(FIXTURE, "V1 → C1A → B×3 → C1D → E");
    const reparsed = parseChordPro(out);
    assert.deepEqual(reparsed.metadata, song.metadata);
    assert.deepEqual(
      reparsed.sections.map((s) => s.sourceLabel),
      ["Verse 1", "Chorus 1a", "Bridge 1/3", "Bridge 2/3", "Bridge 3/3", "Chorus 1d", "Ending"],
    );
    const bridge = song.sections.find((s) => s.id === "B")!;
    for (const s of reparsed.sections.filter((s) => s.type === "bridge")) {
      assert.deepEqual(s.rawLines, bridge.rawLines);
    }
  });
});

describe("simple single-chorus song", () => {
  const SOURCE = `{title: Example Song}
{key: C}

{comment: Verse 1}
[C]Verse one line

{comment: Chorus}
[F]Chorus line

{comment: Verse 2}
[Am]Verse two line

{comment: Bridge}
[G]Bridge line

{comment: Ending}
[C]Ending line
`;

  it("produces the expected chronological ChordPro", () => {
    assert.equal(
      arrange(SOURCE, "V1,C,V2,C,B*2,C,E"),
      `{title: Example Song}
{key: C}

{comment: Verse 1}
[C]Verse one line

{comment: Chorus}
[F]Chorus line

{comment: Verse 2}
[Am]Verse two line

{comment: Chorus}
[F]Chorus line

{comment: Bridge 1/2}
[G]Bridge line

{comment: Bridge 2/2}
[G]Bridge line

{comment: Chorus}
[F]Chorus line

{comment: Ending}
[C]Ending line
`,
    );
  });

  it("counts contiguous repeats however they are written", () => {
    const song = parseChordPro(SOURCE);
    assert.deepEqual(labels(song, "C*2,B,C,C"), ["Chorus 1/2", "Chorus 2/2", "Bridge", "Chorus 1/2", "Chorus 2/2"]);
  });

  it("accepts source labels and case-insensitive ids", () => {
    const song = parseChordPro(SOURCE);
    assert.deepEqual(labels(song, "verse 1, chorus, e"), ["Verse 1", "Chorus", "Ending"]);
  });

  it("rejects unknown sections and zero repetitions", () => {
    const song = parseChordPro(SOURCE);
    assert.throws(() => parseSongMap("V1,X", song), /Unknown section "X"/);
    assert.throws(() => parseSongMap("B*0", song), /at least 1/);
    assert.throws(() => parseSongMap(" , ", song), /empty/);
    assert.throws(() => applyArrangement(song, [{ sectionId: "B", repetitions: 1.5 }]), /Invalid repetition/);
  });

  it("keeps performance-note comments inside their section", () => {
    const song = parseChordPro(SOURCE.replace("[G]Bridge line", "{comment: Build here}\n[G]Bridge line"));
    assert.equal(song.sections.length, 5);
    assert.deepEqual(song.sections.find((s) => s.id === "B")!.rawLines, ["{comment: Build here}", "[G]Bridge line"]);
  });

  it("preserves CRLF line endings", () => {
    const out = arrange(SOURCE.replace(/\n/g, "\r\n"), "V1,C");
    assert.equal(out, "{title: Example Song}\r\n{key: C}\r\n\r\n{comment: Verse 1}\r\n[C]Verse one line\r\n\r\n{comment: Chorus}\r\n[F]Chorus line\r\n");
  });
});
