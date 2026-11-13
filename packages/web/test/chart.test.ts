import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseChartLine, type ChartLine } from "@setflow/core";
import { lyricText, wordPieces } from "../src/chart.js";

const music = (raw: string) => parseChartLine(raw) as Extract<ChartLine, { kind: "music" }>;
const show = (raw: string) => wordPieces(music(raw)).map((w) => w.map((p) => (p.chord ? `${p.chord}:${p.text}` : p.text)).join("|"));

describe("wrapping lines at words (issue #16)", () => {
  it("splits a line into whole words, each chord on its own syllable", () => {
    assert.deepEqual(show("Light the [Am]lamp be-[F]fore the [C]dawn"), ["Light ", "the ", "Am:lamp ", "be-|F:fore ", "the ", "C:dawn"]);
  });

  it("keeps a chord sitting over a space as its own piece", () => {
    assert.deepEqual(show("[G]Sing it [D] out"), ["G:Sing ", "it ", "D: ", "out"]);
  });

  it("handles a chord at the very end of the line", () => {
    assert.deepEqual(show("Amen [C]"), ["Amen ", "C:"]);
  });

  it("loses no text and no chord", () => {
    for (const raw of ["Light the [Am]lamp be - [F]fore the [C]dawn", "[G]Down by the [D]water", "No chords here"]) {
      const line = music(raw);
      const words = wordPieces(line);
      assert.equal(words.flat().map((p) => p.text).join(""), line.lyrics);
      assert.deepEqual(words.flat().flatMap((p) => (p.chord ? [p.chord] : [])), line.chords.map((c) => c.chord));
    }
  });
});

describe("lyrics-only text (issue #18)", () => {
  it("joins syllables split only to place a chord", () => {
    assert.equal(lyricText(music("Light the [Am]lamp be - [F]fore the [C]dawn")), "Light the lamp before the dawn");
    assert.equal(lyricText(music("Hal-[G]le-[D]lujah")), "Hallelujah");
    assert.equal(lyricText(music("Hal-le-[D]lu-jah")), "Hal-lelu-jah", "only the hyphen a chord splits is joined");
  });

  it("keeps real hyphens and dashes", () => {
    assert.equal(lyricText(music("A well-known [G]song")), "A well-known song");
    assert.equal(lyricText(music("Wait - [D] now")), "Wait - now", "a dash before a chord over a space is punctuation");
  });
});
