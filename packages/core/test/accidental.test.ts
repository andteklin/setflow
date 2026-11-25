import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keyAccidental, transposeChord } from "../src/index.js";

describe("chord spelling follows the key", () => {
  it("picks flats for F and sharps for G", () => {
    assert.equal(keyAccidental("F"), "b");
    assert.equal(keyAccidental("Dm"), "b");
    assert.equal(keyAccidental("G"), "#");
    assert.equal(keyAccidental("F#"), "#");
    assert.equal(keyAccidental("Gb"), "b");
  });
  it("spells Bb in F, not A#", () => {
    assert.equal(transposeChord("A", 1, "b"), "Bb");
    assert.equal(transposeChord("A", 1, "#"), "A#");
    assert.equal(transposeChord("D/F#", 1, "b"), "Eb/G");
  });
  it("never turns a natural note into B# or E#", () => {
    // G up to C (5 semitones) in a sharp-side key
    for (const [from, to] of [["G", "C"], ["C", "F"], ["D", "G"], ["Am", "Dm"], ["D/F#", "G/B"], ["Bm", "Em"]]) {
      assert.equal(transposeChord(from, 5, "#"), to);
      assert.equal(transposeChord(from, 5, "b"), to);
    }
  });
  it("respells accidentals to the key but leaves naturals alone", () => {
    assert.equal(transposeChord("F#m7", 5, "b"), "Bm7");
    assert.equal(transposeChord("C#", 5, "b"), "Gb");
    assert.equal(transposeChord("C#", 5, "#"), "F#");
  });
});
