import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  applyArrangement,
  occurrenceLabel,
  parseChordPro,
  parseSongMap,
  PerformanceSession,
  type CommandAck,
  type CommandEnvelope,
  type PerformanceCommand,
  type PerformanceState,
} from "../src/index.js";

const FIXTURE = fs.readFileSync(path.join(import.meta.dirname, "fixtures/sample-variants.cho"), "utf8");
const song = parseChordPro(FIXTURE);
const id = (token: string) => song.sections.find((s) => s.token === token)!.id;
const MD = "md-laptop";

function startSession(map = "I,V1,C1A,V2,C1B,B*2,C1C*2,E") {
  const session = new PerformanceSession({
    sessionId: "s1",
    songId: "morning-lantern",
    arrangementId: "a1",
    arrangementRevision: 1,
    performanceKey: "C",
    plannedSequence: applyArrangement(song, parseSongMap(map, song)),
    sectionIds: song.sections.map((s) => s.id),
    controllerId: MD,
  });
  let n = 0;
  const send = (command: PerformanceCommand, overrides: Partial<CommandEnvelope> = {}): CommandAck =>
    session.submit({
      commandId: `cmd-${++n}`,
      sessionId: "s1",
      expectedRevision: session.state.revision,
      source: "web",
      controllerId: MD,
      command,
      ...overrides,
    });
  return { session, send };
}

/** What a band display shows: "Bridge 3/3", and what comes next. */
function display(state: PerformanceState) {
  const byId = new Map(song.sections.map((s) => [s.id, s]));
  const label = (occId: string | null) => {
    const occ = state.sequence.find((o) => o.id === occId);
    return occ ? occurrenceLabel(byId.get(occ.sectionId)!, occ) : null;
  };
  return {
    status: state.status,
    current: label(state.currentOccurrenceId),
    next: label(state.nextOccurrenceId),
    vamping: state.vamping,
  };
}

function accepted(ack: CommandAck): PerformanceState {
  assert.equal(ack.accepted, true, ack.accepted ? "" : ack.message);
  return ack.state;
}

function rejectedFor(ack: CommandAck): string | undefined {
  return ack.accepted ? undefined : ack.reason;
}

describe("§30.2 conduct a live band without tracks", () => {
  it("runs the walkthrough end to end", () => {
    const { session, send } = startSession();
    const planned = session.state.plannedSequence;
    assert.deepEqual(display(session.state), { status: "ready", current: null, next: "Intro", vamping: false });

    // 2. NEXT enters the Intro.
    assert.deepEqual(display(accepted(send({ type: "NEXT" }))), {
      status: "active",
      current: "Intro",
      next: "Verse 1",
      vamping: false,
    });

    // 3. Advance to Bridge 2/2, then REPEAT: Bridge 3/3 with C1C next. The plan still has B×2.
    for (let i = 0; i < 6; i++) accepted(send({ type: "NEXT" }));
    assert.equal(display(session.state).current, "Bridge 2/2");
    let state = accepted(send({ type: "REPEAT" }));
    assert.deepEqual(display(state), { status: "active", current: "Bridge 3/3", next: "Chorus 1c 1/2", vamping: false });
    assert.deepEqual(state.repetition, { index: 3, total: 3 });
    assert.equal(state.plannedSequence, planned);
    assert.equal(planned.filter((o) => o.sectionId === id("B")).length, 2);

    // 4. JUMP to the exact C1C variant by section id; NEXT follows that occurrence.
    state = accepted(send({ type: "JUMP", sectionId: id("C1C") }));
    assert.equal(display(state).current, "Chorus 1c 1/2");
    state = accepted(send({ type: "NEXT" }));
    assert.equal(display(state).current, "Chorus 1c 2/2");

    // 5. PREVIOUS, then JUMP to INST, which the map leaves out: inserted live, prior successor kept.
    state = accepted(send({ type: "PREVIOUS" }));
    assert.equal(display(state).current, "Chorus 1c 1/2");
    const priorSuccessor = state.nextOccurrenceId;
    state = accepted(send({ type: "JUMP", sectionId: id("INST") }));
    const inst = state.sequence.find((o) => o.id === state.currentOccurrenceId)!;
    assert.equal(inst.origin, "live");
    assert.equal(inst.sectionId, id("INST"));
    assert.equal(state.nextOccurrenceId, priorSuccessor);

    // 6. Bridge, VAMP: indefinite hold with the exit labelled; REPEAT counts; NEXT exits.
    state = accepted(send({ type: "JUMP", sectionId: id("B") }));
    const exitTarget = state.nextOccurrenceId;
    state = accepted(send({ type: "VAMP" }));
    assert.equal(state.vamping, true);
    assert.equal(state.repetition.total, null);
    assert.equal(state.nextOccurrenceId, exitTarget);
    const before = state.repetition.index;
    state = accepted(send({ type: "REPEAT" }));
    assert.equal(state.vamping, true);
    assert.equal(state.repetition.index, before + 1);
    assert.equal(state.nextOccurrenceId, exitTarget);
    state = accepted(send({ type: "NEXT" }));
    assert.equal(state.vamping, false);
    assert.equal(state.currentOccurrenceId, exitTarget);

    // 7. END: no current or next; not the same as jumping to Ending.
    state = accepted(send({ type: "END" }));
    assert.deepEqual(display(state), { status: "ended", current: null, next: null, vamping: false });

    // Deviations are logged in order; NEXT follows the plan and is not one.
    assert.deepEqual(
      state.liveDeviations.map((d) => d.command.type),
      ["REPEAT", "JUMP", "PREVIOUS", "JUMP", "JUMP", "VAMP", "REPEAT", "END"],
    );
  });

  it("distinguishes END from jumping to the Ending section", () => {
    const { send } = startSession();
    accepted(send({ type: "NEXT" }));
    const state = accepted(send({ type: "JUMP", sectionId: id("E") }));
    assert.deepEqual(display(state), { status: "active", current: "Ending", next: null, vamping: false });
    assert.equal(accepted(send({ type: "NEXT" })).status, "ended");
  });
});

describe("command semantics (spec §19.2)", () => {
  it("requires a current section for REPEAT, VAMP and PREVIOUS", () => {
    const { send } = startSession();
    for (const type of ["REPEAT", "VAMP", "PREVIOUS"] as const) {
      assert.equal(rejectedFor(send({ type })), "invalid-command");
    }
  });

  it("starts at the target when JUMP is the first command", () => {
    const { send } = startSession();
    const state = accepted(send({ type: "JUMP", sectionId: id("B") }));
    assert.deepEqual(display(state), { status: "active", current: "Bridge 1/2", next: "Bridge 2/2", vamping: false });
  });

  it("inserts an absent section before the first one when jumping from ready", () => {
    const { send } = startSession("V1,E");
    const state = accepted(send({ type: "JUMP", sectionId: id("I") }));
    assert.deepEqual(display(state), { status: "active", current: "Intro", next: "Verse 1", vamping: false });
  });

  it("uses a given occurrence id and rejects one that is not a visit to the section", () => {
    const { session, send } = startSession();
    accepted(send({ type: "NEXT" }));
    const secondC1C = session.state.sequence.filter((o) => o.sectionId === id("C1C"))[1];
    const state = accepted(send({ type: "JUMP", sectionId: id("C1C"), targetOccurrenceId: secondC1C.id }));
    assert.equal(display(state).current, "Chorus 1c 2/2");
    const ack = send({ type: "JUMP", sectionId: id("B"), targetOccurrenceId: secondC1C.id });
    assert.equal(rejectedFor(ack), "invalid-command");
    assert.equal(ack.state, state);
  });

  it("prefers the next matching occurrence after the current one, falling back to the first", () => {
    const { send } = startSession("C1A,V1,C1A,E");
    accepted(send({ type: "NEXT" }));
    let state = accepted(send({ type: "JUMP", sectionId: id("C1A") }));
    assert.equal(state.currentOccurrenceId, "occ-3");
    state = accepted(send({ type: "JUMP", sectionId: id("C1A") }));
    assert.equal(state.currentOccurrenceId, "occ-1");
  });

  it("treats PREVIOUS at the start and a second VAMP as accepted no-ops", () => {
    const { session, send } = startSession();
    accepted(send({ type: "NEXT" }));
    const at = session.state.revision;
    accepted(send({ type: "PREVIOUS" }));
    assert.equal(session.state.revision, at);
    accepted(send({ type: "VAMP" }));
    accepted(send({ type: "VAMP" }));
    assert.equal(session.state.revision, at + 1);
  });

  it("ends on NEXT from the last occurrence and refuses to restart", () => {
    const { send } = startSession("E");
    accepted(send({ type: "NEXT" }));
    assert.equal(accepted(send({ type: "NEXT" })).status, "ended");
    assert.equal(rejectedFor(send({ type: "NEXT" })), "invalid-command");
    assert.equal(rejectedFor(send({ type: "JUMP", sectionId: id("I") })), "invalid-command");
  });

  it("goes back from the end to the section it ended on (issue #12)", () => {
    // A NEXT too many on the last section.
    const { send } = startSession("V1,E");
    accepted(send({ type: "NEXT" }));
    accepted(send({ type: "NEXT" }));
    assert.equal(accepted(send({ type: "NEXT" })).status, "ended");
    let state = accepted(send({ type: "PREVIOUS" }));
    assert.deepEqual(display(state), { status: "active", current: "Ending", next: null, vamping: false });
    assert.equal(accepted(send({ type: "NEXT" })).status, "ended", "and it can end again");

    // An accidental END mid-song reopens where the band was, not at the last section.
    const second = startSession("V1,B,E");
    second.send({ type: "NEXT" });
    second.send({ type: "NEXT" });
    accepted(second.send({ type: "END" }));
    state = accepted(second.send({ type: "PREVIOUS" }));
    assert.deepEqual(display(state), { status: "active", current: "Bridge", next: "Ending", vamping: false });
    assert.equal(state.liveDeviations.at(-1)?.command.type, "PREVIOUS");

    // Ended before anything was played: back to Ready.
    const third = startSession("V1");
    accepted(third.send({ type: "END" }));
    assert.equal(accepted(third.send({ type: "PREVIOUS" })).status, "ready");
  });

  it("keeps repetition counters to the contiguous run after a live insertion", () => {
    const { send } = startSession("B*2,E");
    accepted(send({ type: "NEXT" }));
    const state = accepted(send({ type: "REPEAT" }));
    assert.deepEqual(
      state.sequence.map((o) => [o.sectionId === id("B") ? "B" : "E", o.repetitionIndex + 1, o.repetitionCount, o.occurrenceIndex]),
      [
        ["B", 1, 3, 0],
        ["B", 2, 3, 1],
        ["B", 3, 3, 2],
        ["E", 1, 1, 3],
      ],
    );
  });

  it("never mutates a published snapshot", () => {
    const { session, send } = startSession();
    const snapshot = session.state;
    accepted(send({ type: "NEXT" }));
    accepted(send({ type: "REPEAT" }));
    assert.equal(snapshot.currentOccurrenceId, null);
    assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.sequence) && Object.isFrozen(snapshot.sequence[0]));
  });
});

describe("command gateway (spec §19.3, §30.3)", () => {
  it("does not execute a retried command twice", () => {
    const { session, send } = startSession();
    accepted(send({ type: "NEXT" }, { commandId: "press-1" }));
    const revision = session.state.revision;
    const retry = send({ type: "NEXT" }, { commandId: "press-1", expectedRevision: 0 });
    assert.equal(retry.accepted, true);
    assert.equal(retry.duplicate, true);
    assert.equal(session.state.revision, revision);
    assert.equal(display(session.state).current, "Intro");
  });

  it("does not suppress deliberate repeated presses", () => {
    const { send } = startSession();
    accepted(send({ type: "NEXT" }, { commandId: "press-1" }));
    accepted(send({ type: "NEXT" }, { commandId: "press-2" }));
    assert.equal(display(accepted(send({ type: "NEXT" }, { commandId: "press-3" }))).current, "Chorus 1a");
  });

  it("rejects stale revisions with a fresh snapshot instead of replaying them", () => {
    const { session, send } = startSession();
    accepted(send({ type: "NEXT" }));
    const ack = send({ type: "NEXT" }, { expectedRevision: 0 });
    assert.equal(rejectedFor(ack), "stale-revision");
    assert.equal(ack.state, session.state);
    assert.equal(display(session.state).current, "Intro");
  });

  it("rejects view-only controllers and commands for another session", () => {
    const { session, send } = startSession();
    assert.equal(rejectedFor(send({ type: "NEXT" }, { controllerId: "drummer-ipad" })), "unauthorized");
    assert.equal(rejectedFor(send({ type: "NEXT" }, { sessionId: "s0" })), "wrong-session");
    assert.equal(session.state.revision, 0);

    session.setController("drummer-ipad");
    accepted(send({ type: "NEXT" }, { controllerId: "drummer-ipad" }));
  });

  it("rejects invalid jump targets without changing state", () => {
    const { session, send } = startSession();
    accepted(send({ type: "NEXT" }));
    const before = session.state;
    assert.equal(rejectedFor(send({ type: "JUMP", sectionId: "not-a-section" })), "invalid-command");
    assert.equal(session.state, before);
  });

  it("resumes a saved snapshot under a new session id, rejecting the old one", () => {
    const { session, send } = startSession();
    accepted(send({ type: "NEXT" }));
    accepted(send({ type: "REPEAT" }));
    const saved = JSON.parse(JSON.stringify(session.state));

    const resumed = PerformanceSession.resume(saved, {
      sessionId: "s2",
      sectionIds: song.sections.map((s) => s.id),
      controllerId: MD,
    });
    assert.equal(resumed.state.sessionId, "s2");
    assert.equal(resumed.state.currentOccurrenceId, session.state.currentOccurrenceId);
    assert.deepEqual(resumed.state.sequence, session.state.sequence);
    assert.ok(Object.isFrozen(resumed.state.sequence[0]));

    const base = { commandId: "x", expectedRevision: resumed.state.revision, source: "web" as const, controllerId: MD };
    assert.equal(rejectedFor(resumed.submit({ ...base, sessionId: "s1", command: { type: "NEXT" } })), "wrong-session");
    assert.equal(resumed.submit({ ...base, commandId: "y", sessionId: "s2", command: { type: "NEXT" } }).accepted, true);
  });

  it("revisions key and cue changes through the same authority", () => {
    const { session } = startSession();
    session.setPerformanceKey("D");
    session.setCues(["Build into chorus"]);
    assert.equal(session.state.revision, 2);
    assert.equal(session.state.performanceKey, "D");
    assert.deepEqual(session.state.cues, ["Build into chorus"]);
  });
});
