import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { insertAt, insertionIndex, isNoOpMove, moveTo } from "../src/drag.js";

describe("drag and drop positions (issue #5)", () => {
  // Three rows centred at y = 10, 30, 50.
  const mids = [10, 30, 50];

  it("finds the gap under the pointer", () => {
    assert.equal(insertionIndex(mids, 0), 0, "above the first row");
    assert.equal(insertionIndex(mids, 15), 1, "between rows 1 and 2");
    assert.equal(insertionIndex(mids, 45), 2);
    assert.equal(insertionIndex(mids, 99), 3, "below the last row");
    assert.equal(insertionIndex([], 5), 0, "an empty list takes the drop at 0");
  });

  it("moves a row down or up by insertion index", () => {
    const list = ["I", "V1", "C", "B"];
    assert.deepEqual(moveTo(list, 0, 3), ["V1", "C", "I", "B"], "drop I between C and B");
    assert.deepEqual(moveTo(list, 0, 4), ["V1", "C", "B", "I"], "drop I at the end");
    assert.deepEqual(moveTo(list, 3, 1), ["I", "B", "V1", "C"], "drop B between I and V1");
    assert.deepEqual(list, ["I", "V1", "C", "B"], "the input is not mutated");
  });

  it("recognises drops that change nothing", () => {
    assert.ok(isNoOpMove(1, 1));
    assert.ok(isNoOpMove(1, 2));
    assert.ok(!isNoOpMove(1, 3));
    assert.deepEqual(moveTo(["a", "b", "c"], 1, 2), ["a", "b", "c"]);
  });

  it("inserts a new section exactly where it is dropped", () => {
    assert.deepEqual(insertAt(["V1", "C"], 1, "PC"), ["V1", "PC", "C"]);
    assert.deepEqual(insertAt(["V1", "C"], 0, "I"), ["I", "V1", "C"]);
    assert.deepEqual(insertAt(["V1", "C"], 9, "E"), ["V1", "C", "E"], "past the end appends");
  });
});
