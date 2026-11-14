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
});
