import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyArrangement,
  ArrangedEditError,
  arrangedChordPro,
  fitNotes,
  notesByOccurrence,
  parseArrangedNotes,
  parseChordPro,
  parseSongMap,
  serializeChordPro,
  type ArrangementNote,
} from "../src/index.js";

const SONG = parseChordPro(`{title: Arranged (Example)}
{key: C}

{comment: Verse 1}
[C]Line one
{comment: Build here}
[F]Line two

{comment: Bridge}
[Am]Up we [F]go
[C]Higher

{comment: Ending}
[C]Amen
`);
const ITEMS = parseSongMap("V1, B*2, E", SONG);

describe("arranged ChordPro (issue #9)", () => {
  it("matches the plain arranged export when there are no notes", () => {
    assert.equal(
      arrangedChordPro(SONG, ITEMS, [], { songMap: "V1 → B×2 → E" }),
      serializeChordPro(SONG, applyArrangement(SONG, ITEMS), { songMap: "V1 → B×2 → E" }),
    );
  });

  it("keeps the source's own comments in the arranged chart", () => {
    assert.match(arrangedChordPro(SONG, ITEMS), /\{comment: Verse 1\}\n\[C\]Line one\n\{comment: Build here\}\n\[F\]Line two/);
  });

  it("reads added comments back as notes for that exact occurrence and line", () => {
    const base = arrangedChordPro(SONG, ITEMS);
    const edited = base
      .replace("{comment: Bridge 2/2}\n[Am]Up we [F]go\n", "{comment: Bridge 2/2}\n[Am]Up we [F]go\n{ci: Drums out}\n")
      .replace("{comment: Ending}\n", "{comment: Ending}\n# Hold the last chord\n");
    const notes = parseArrangedNotes(SONG, ITEMS, edited);
    const bridge = SONG.sections.find((s) => s.token === "B")!;
    const ending = SONG.sections.find((s) => s.token === "E")!;
    assert.deepEqual(notes, [
      { item: 1, repetition: 1, sectionId: bridge.id, afterLine: 1, text: "{ci: Drums out}" },
      { item: 2, repetition: 0, sectionId: ending.id, afterLine: 0, text: "# Hold the last chord" },
    ]);
    // Writing the notes back reproduces the edit exactly.
    assert.equal(arrangedChordPro(SONG, ITEMS, notes), edited);
    // The song itself is untouched.
    assert.equal(bridge.rawLines.length, 2);
  });

  it("drops a note when its comment line is deleted, and tolerates blank-line edits", () => {
    const withNote = arrangedChordPro(SONG, ITEMS, [{ item: 0, repetition: 0, sectionId: SONG.sections[0].id, afterLine: 2, text: "{ci: Soft}" }]);
    assert.equal(parseArrangedNotes(SONG, ITEMS, withNote.replace("{ci: Soft}\n", "")).length, 0);
    assert.equal(parseArrangedNotes(SONG, ITEMS, withNote.replace(/\n\n/g, "\n\n\n")).length, 1, "extra blank lines are fine");
    assert.equal(parseArrangedNotes(SONG, ITEMS, withNote.replace(/\n\n\{comment: Ending/, "\n{comment: Ending")).length, 1, "a removed blank line is fine");
  });

  it("refuses edits to the song itself, saying which line", () => {
    const base = arrangedChordPro(SONG, ITEMS);
    const lines = base.split("\n");
    const chordLine = lines.indexOf("[C]Higher") + 1;
    assert.throws(
      () => parseArrangedNotes(SONG, ITEMS, base.replace("[C]Higher", "[D]Higher")),
      (err: unknown) => err instanceof ArrangedEditError && err.line === chordLine && /ChordPro source/.test(err.message),
    );
    assert.throws(() => parseArrangedNotes(SONG, ITEMS, base.replace("[C]Amen\n", "")), /missing/);
    assert.throws(() => parseArrangedNotes(SONG, ITEMS, base.replace("{key: C}", "{key: C}\n{ci: too early}")), /inside a section/);
    assert.throws(
      () => parseArrangedNotes(SONG, ITEMS, base.replace("[C]Higher", "[C]Higher\n{comment: Chorus}")),
      /would read as a section heading/,
    );
  });

  it("keeps notes that still fit after the map or source changes, and drops the rest", () => {
    const bridge = SONG.sections.find((s) => s.token === "B")!;
    const notes: ArrangementNote[] = [
      { item: 1, repetition: 1, sectionId: bridge.id, afterLine: 9, text: "{ci: Last time}" },
      { item: 1, repetition: 0, sectionId: "sec-gone", afterLine: 0, text: "{ci: Stale}" },
    ];
    assert.deepEqual(fitNotes(SONG, ITEMS, notes), [{ ...notes[0], afterLine: 2 }], "clamped to the section's end; the stale one is gone");
    assert.deepEqual(fitNotes(SONG, parseSongMap("V1, B, E", SONG), notes), [], "Bridge is played once now, so pass 2 has no note");

    const byOcc = notesByOccurrence(SONG, ITEMS, notes);
    assert.deepEqual(byOcc.map((n) => n.length), [0, 0, 1, 0]);
  });
});
