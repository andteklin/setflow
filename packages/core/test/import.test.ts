import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  applyArrangement,
  chartLines,
  parseChartLine,
  parseChordPro,
  parseSongMap,
  semitoneDistance,
  serializeChordPro,
  songMetadata,
  sourceOrderArrangement,
  transposeChartLine,
  transposeChord,
  type ChartLine,
} from "../src/index.js";

const FIXTURE = fs.readFileSync(path.join(import.meta.dirname, "fixtures/sample-variants.cho"), "utf8");
const song = parseChordPro(FIXTURE);
const section = (token: string) => song.sections.find((s) => s.token === token)!;
const music = (lines: ChartLine[]) => lines.filter((l) => l.kind === "music");

describe("structured metadata (spec §4)", () => {
  it("reads the common directives", () => {
    const m = songMetadata(song);
    assert.equal(m.title, "Morning Lantern (Example)");
    assert.equal(m.originalKey, "C");
    assert.equal(m.tempo, 84);
    assert.equal(m.timeSignature, "4/4");
    assert.equal(m.ccliNumber, "7654321");
    assert.equal(m.ccliLicense, "1234567");
    assert.match(m.artist!, /SetFlow Example/);
    assert.match(m.footer!, /^For use solely/);
  });

  it("keeps unknown directives instead of failing", () => {
    const m = songMetadata(parseChordPro("{title: Test}\n{capo: 2}\n{comment: Verse 1}\n[C]hello\n"));
    assert.deepEqual(m.extra, { capo: "2" });
  });
});

describe("chart lines (spec §13–14)", () => {
  it("separates lyrics from positioned chords", () => {
    assert.deepEqual(parseChartLine("Over the [C]water, [F]over"), {
      kind: "music",
      lyrics: "Over the water, over",
      chords: [
        { offset: 9, chord: "C" },
        { offset: 16, chord: "F" },
      ],
      isChordOnly: false,
    });
  });

  it("treats bar notation as chord-only content", () => {
    const [intro] = music(chartLines(section("I")));
    assert.equal(intro.kind === "music" && intro.isChordOnly, true);
    assert.deepEqual(
      intro.kind === "music" && intro.chords.map((c) => c.chord),
      ["|", "Am", "F", "|", "C", "|", "Am", "F", "|", "C", "|"],
    );
  });

  it("keeps in-section comments and directives as their own lines", () => {
    assert.deepEqual(parseChartLine("{comment: Build here}"), { kind: "comment", text: "Build here" });
    assert.deepEqual(parseChartLine("{start_of_tab}"), { kind: "directive", name: "start_of_tab", value: "" });
    assert.deepEqual(parseChartLine("  "), { kind: "blank" });
  });

  it("hides # comment lines from the band but keeps them in the source (issue #8)", () => {
    assert.deepEqual(parseChartLine("# Drums out"), { kind: "hidden", text: "Drums out" });
    assert.deepEqual(parseChartLine("  #{comment: Build here}"), { kind: "hidden", text: "{comment: Build here}" });
    // A sharp inside a line is a chord, not a comment.
    assert.equal(parseChartLine("[C#m]Lift your [F#]eyes").kind, "music");

    const text = "{title: X}\n\n{comment: Verse 1}\n[C]Line one\n# {comment: Bridge}\n# Acoustic only\n[F]Line two\n";
    const parsed = parseChordPro(text);
    assert.deepEqual(parsed.sections.map((s) => s.token), ["V1"], "a commented-out marker starts no section");
    assert.deepEqual(chartLines(parsed.sections[0]).map((l) => l.kind), ["music", "hidden", "hidden", "music"]);
    assert.match(serializeChordPro(parsed, applyArrangement(parsed, sourceOrderArrangement(parsed))), /# Acoustic only/);
  });

  it("rebuilds each raw line from its parts", () => {
    for (const s of song.sections) {
      chartLines(s).forEach((line, i) => {
        if (line.kind !== "music") return;
        let rebuilt = line.lyrics;
        for (const c of [...line.chords].reverse()) {
          rebuilt = `${rebuilt.slice(0, c.offset)}[${c.chord}]${rebuilt.slice(c.offset)}`;
        }
        assert.equal(rebuilt, s.rawLines[i]);
      });
    }
  });
});

describe("transposition (spec §15)", () => {
  it("transposes chords and slash bass notes, leaving bars alone", () => {
    assert.equal(semitoneDistance("C", "D"), 2);
    assert.deepEqual(
      ["C", "Am", "F", "G", "G/B", "C/E", "|"].map((c) => transposeChord(c, 2)),
      ["D", "Bm", "G", "A", "A/C#", "D/F#", "|"],
    );
  });

  it("never touches lyrics, labels or the source", () => {
    const bridge = section("B");
    const before = structuredClone(bridge);
    const lines = chartLines(bridge);
    const up = lines.map((l) => transposeChartLine(l, 2));
    assert.deepEqual(
      up.map((l) => (l.kind === "music" ? l.lyrics : null)),
      lines.map((l) => (l.kind === "music" ? l.lyrics : null)),
    );
    assert.ok(music(up).some((l) => l.kind === "music" && l.chords.some((c) => c.chord === "D/F#")));
    assert.deepEqual(bridge, before);
  });
});

describe("planned occurrences (spec §19)", () => {
  it("marks expanded occurrences as planned with stable unique ids", () => {
    const occurrences = applyArrangement(song, parseSongMap("I,B*2,E", song));
    assert.ok(occurrences.every((o) => o.origin === "planned"));
    assert.deepEqual(occurrences.map((o) => o.id), ["occ-1", "occ-2", "occ-3", "occ-4"]);
  });

  it("source order references every section once", () => {
    assert.deepEqual(
      sourceOrderArrangement(song).map((i) => [i.sectionId, i.repetitions]),
      song.sections.map((s) => [s.id, 1]),
    );
  });
});
