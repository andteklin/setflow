import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCommand, createPerformance, type PerformanceCommand, type PerformanceState } from "@setflow/core";
import { largestFit } from "../src/fit.js";
import { bubbleFamily, bubbleStates, scrollTarget } from "../src/sectionMap.js";

/** A five-occurrence performance: V1 C B B E, with B played twice. */
function performance(): { state: PerformanceState; send: (c: PerformanceCommand) => PerformanceState } {
  const occ = (id: string, sectionId: string, rep = 0, count = 1) => ({
    id,
    origin: "planned" as const,
    sectionId,
    occurrenceIndex: 0,
    repetitionIndex: rep,
    repetitionCount: count,
  });
  let state = createPerformance({
    sessionId: "s",
    songId: "song",
    arrangementId: "a",
    arrangementRevision: 1,
    performanceKey: "C",
    plannedSequence: [occ("o1", "v1"), occ("o2", "c"), occ("o3", "b", 0, 2), occ("o4", "b", 1, 2), occ("o5", "e")],
  });
  let n = 0;
  return {
    get state() {
      return state;
    },
    send(command) {
      const r = applyCommand(state, command, { commandId: `c${++n}`, sectionIds: new Set(["v1", "c", "b", "e"]) });
      if (!r.ok) throw new Error(r.error);
      state = r.state;
      return state;
    },
  };
}

describe("stage song map (bubbles)", () => {
  it("marks the next bubble before the song starts", () => {
    assert.deepEqual(bubbleStates(performance().state), ["next", "upcoming", "upcoming", "upcoming", "upcoming"]);
  });

  it("follows the band: played, current, next, upcoming", () => {
    const p = performance();
    p.send({ type: "NEXT" });
    p.send({ type: "NEXT" });
    p.send({ type: "NEXT" });
    assert.deepEqual(bubbleStates(p.state), ["played", "played", "current", "next", "upcoming"]);
  });

  it("adds a bubble for a live repeat and keeps the highlight on it", () => {
    const p = performance();
    p.send({ type: "NEXT" });
    const state = p.send({ type: "REPEAT" });
    assert.equal(state.sequence.length, 6);
    assert.deepEqual(bubbleStates(state), ["played", "current", "next", "upcoming", "upcoming", "upcoming"]);
  });

  it("shows everything played up to where an ended song stopped", () => {
    const p = performance();
    p.send({ type: "NEXT" });
    p.send({ type: "NEXT" });
    const state = p.send({ type: "END" });
    assert.deepEqual(bubbleStates(state), ["played", "played", "upcoming", "upcoming", "upcoming"]);
  });

  it("colours sections by family", () => {
    assert.equal(bubbleFamily("verse"), "verse");
    assert.equal(bubbleFamily("refrain"), "chorus");
    assert.equal(bubbleFamily("postchorus"), "pre");
    assert.equal(bubbleFamily("breakdown"), "bridge");
    assert.equal(bubbleFamily("ending"), "inst");
    assert.equal(bubbleFamily("custom"), "custom");
  });

  it("scrolls so the current bubble sits a third of the way in, within the strip's bounds", () => {
    assert.equal(scrollTarget(50, 900, 2000), 0, "near the start: no scroll");
    assert.equal(scrollTarget(800, 900, 2000), 500);
    assert.equal(scrollTarget(1900, 900, 2000), 1100, "never past the end");
    assert.equal(scrollTarget(400, 900, 600), 0, "a strip that fits never scrolls");
  });
});

describe("autosizing (issue #13)", () => {
  it("finds the largest size that fits", () => {
    assert.equal(largestFit(14, 200, (px) => px <= 87), 87);
    assert.equal(largestFit(14, 200, () => true), 200, "a short section grows to the cap");
    assert.equal(largestFit(14, 200, () => false), 14, "never below the floor, so text never vanishes");
  });

  it("needs only a few layout passes", () => {
    let calls = 0;
    largestFit(14, 400, (px) => (calls++, px <= 123));
    assert.ok(calls <= 10, `${calls} passes`);
  });
});
