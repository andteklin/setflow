import type { SectionOccurrence } from "./types.js";

/** Live band commands (spec §19.1). Each acts immediately when accepted; nothing is timed. */
export type PerformanceCommand =
  | { type: "NEXT" }
  | { type: "PREVIOUS" }
  | { type: "REPEAT" }
  | { type: "JUMP"; sectionId: string; targetOccurrenceId?: string }
  | { type: "VAMP" }
  | { type: "END" };

export interface LiveDeviation {
  revision: number;
  commandId: string;
  command: PerformanceCommand;
  fromOccurrenceId: string | null;
  toOccurrenceId: string | null;
}

/** One complete, immutable snapshot of band state. Views render this; they never count button presses. */
export interface PerformanceState {
  sessionId: string;
  revision: number;
  songId: string;
  arrangementId: string;
  arrangementRevision: number;
  status: "ready" | "active" | "ended";
  performanceKey: string;
  /** The saved plan as expanded at session start. Live commands never change it. */
  plannedSequence: readonly SectionOccurrence[];
  /** The effective session sequence: the plan plus live insertions. */
  sequence: readonly SectionOccurrence[];
  currentOccurrenceId: string | null;
  /** While vamping, the occurrence NEXT exits to. */
  nextOccurrenceId: string | null;
  vamping: boolean;
  /** 1-based position in the current contiguous run; `total` is null during an open vamp. */
  repetition: { index: number; total: number | null };
  cues: readonly string[];
  liveDeviations: readonly LiveDeviation[];
}

export interface PerformanceInit {
  sessionId: string;
  songId: string;
  arrangementId: string;
  arrangementRevision: number;
  performanceKey: string;
  plannedSequence: readonly SectionOccurrence[];
  cues?: readonly string[];
}

/** A session that has not started: nothing is current, the first occurrence is next. */
export function createPerformance(init: PerformanceInit): PerformanceState {
  const plannedSequence = Object.freeze(init.plannedSequence.map((o) => Object.freeze({ ...o })));
  return derive({
    sessionId: init.sessionId,
    revision: 0,
    songId: init.songId,
    arrangementId: init.arrangementId,
    arrangementRevision: init.arrangementRevision,
    status: "ready",
    performanceKey: init.performanceKey,
    plannedSequence,
    sequence: plannedSequence,
    currentOccurrenceId: null,
    vamping: false,
    cues: Object.freeze([...(init.cues ?? [])]),
    liveDeviations: [],
  });
}

/**
 * Continue a saved snapshot (e.g. after a host restart) under a new session id,
 * so commands addressed to the old session can never apply (spec §25).
 */
export function resumePerformance(previous: PerformanceState, sessionId: string): PerformanceState {
  const freezeAll = (occurrences: readonly SectionOccurrence[]) =>
    Object.freeze(occurrences.map((o) => Object.freeze({ ...o })));
  return derive({
    ...previous,
    sessionId,
    revision: previous.revision + 1,
    plannedSequence: freezeAll(previous.plannedSequence),
    sequence: freezeAll(previous.sequence),
    cues: Object.freeze([...previous.cues]),
  });
}

export type TransitionResult =
  | { ok: true; state: PerformanceState; changed: boolean }
  | { ok: false; error: string };

export interface TransitionContext {
  commandId: string;
  /** Section ids of the active song, so JUMP can reject targets that are not in it. */
  sectionIds: ReadonlySet<string>;
}

/**
 * Apply one command to a snapshot (spec §19.2). Returns a new snapshot with
 * the revision advanced, or the same snapshot with `changed: false` for an
 * accepted no-op (PREVIOUS at the start, a second VAMP). Invalid commands are
 * rejected and leave the state untouched.
 */
export function applyCommand(
  state: PerformanceState,
  command: PerformanceCommand,
  ctx: TransitionContext,
): TransitionResult {
  if (state.status === "ended") {
    return reject("The performance has ended; start a new session to play again");
  }
  const pos = state.sequence.findIndex((o) => o.id === state.currentOccurrenceId);
  const revision = state.revision + 1;
  const liveId = `live-${revision}`;

  let draft: Draft;
  switch (command.type) {
    case "NEXT": {
      if (state.status === "ready" && state.sequence.length > 0) {
        draft = { ...state, status: "active", currentOccurrenceId: state.sequence[0].id, vamping: false };
      } else if (pos + 1 < state.sequence.length) {
        draft = { ...state, currentOccurrenceId: state.sequence[pos + 1].id, vamping: false };
      } else {
        draft = ended(state);
      }
      break;
    }
    case "PREVIOUS": {
      if (pos < 0) return reject("PREVIOUS needs a current section");
      if (pos === 0) {
        if (!state.vamping) return unchanged(state);
        draft = { ...state, vamping: false };
      } else {
        draft = { ...state, currentOccurrenceId: state.sequence[pos - 1].id, vamping: false };
      }
      break;
    }
    case "REPEAT": {
      if (pos < 0) return reject("REPEAT needs a current section");
      const current = state.sequence[pos];
      const sequence = insertAt(state.sequence, pos + 1, current.sectionId, liveId);
      draft = { ...state, sequence, currentOccurrenceId: liveId };
      break;
    }
    case "JUMP": {
      if (!ctx.sectionIds.has(command.sectionId)) {
        return reject(`Section ${command.sectionId} is not in this song`);
      }
      const matches = (o: SectionOccurrence) => o.sectionId === command.sectionId;
      if (command.targetOccurrenceId !== undefined) {
        const target = state.sequence.find((o) => o.id === command.targetOccurrenceId);
        if (!target || !matches(target)) {
          return reject(`Occurrence ${command.targetOccurrenceId} is not a visit to section ${command.sectionId}`);
        }
        draft = { ...state, currentOccurrenceId: target.id };
      } else {
        const target =
          state.sequence.find((o, i) => i > pos && matches(o)) ?? state.sequence.find(matches);
        if (target) {
          draft = { ...state, currentOccurrenceId: target.id };
        } else {
          // Not in the plan: play it once now, then carry on to the prior successor.
          const sequence = insertAt(state.sequence, pos + 1, command.sectionId, liveId);
          draft = { ...state, sequence, currentOccurrenceId: liveId };
        }
      }
      draft = { ...draft, status: "active", vamping: false };
      break;
    }
    case "VAMP": {
      if (pos < 0) return reject("VAMP needs a current section");
      if (state.vamping) return unchanged(state);
      draft = { ...state, vamping: true };
      break;
    }
    case "END": {
      draft = ended(state);
      break;
    }
  }

  const liveDeviations =
    command.type === "NEXT"
      ? state.liveDeviations
      : [
          ...state.liveDeviations,
          {
            revision,
            commandId: ctx.commandId,
            command,
            fromOccurrenceId: state.currentOccurrenceId,
            toOccurrenceId: draft.currentOccurrenceId,
          },
        ];
  return { ok: true, changed: true, state: derive({ ...draft, revision, liveDeviations }) };
}

/** Host-controlled changes (spec §19.2) that go through the same revision authority as commands. */
export function setPerformanceKey(state: PerformanceState, performanceKey: string): PerformanceState {
  return derive({ ...state, revision: state.revision + 1, performanceKey });
}

export function setCues(state: PerformanceState, cues: readonly string[]): PerformanceState {
  return derive({ ...state, revision: state.revision + 1, cues: Object.freeze([...cues]) });
}

type Draft = Omit<PerformanceState, "nextOccurrenceId" | "repetition">;

const reject = (error: string): TransitionResult => ({ ok: false, error });
const unchanged = (state: PerformanceState): TransitionResult => ({ ok: true, changed: false, state });
const ended = (state: PerformanceState): Draft => ({
  ...state,
  status: "ended",
  currentOccurrenceId: null,
  vamping: false,
});

/** Insert a live occurrence and renumber positions and contiguous repetition runs. */
function insertAt(
  sequence: readonly SectionOccurrence[],
  index: number,
  sectionId: string,
  id: string,
): SectionOccurrence[] {
  const inserted: SectionOccurrence = {
    id,
    origin: "live",
    sectionId,
    occurrenceIndex: 0,
    repetitionIndex: 0,
    repetitionCount: 1,
  };
  const next = [...sequence.slice(0, index), inserted, ...sequence.slice(index)];
  for (let start = 0; start < next.length; ) {
    let end = start;
    while (end < next.length && next[end].sectionId === next[start].sectionId) end++;
    for (let i = start; i < end; i++) {
      next[i] = { ...next[i], occurrenceIndex: i, repetitionIndex: i - start, repetitionCount: end - start };
    }
    start = end;
  }
  return next;
}

/** Fill in the fields that follow from the sequence and the current occurrence, and freeze. */
function derive(draft: Draft): PerformanceState {
  const sequence = Object.isFrozen(draft.sequence) ? draft.sequence : Object.freeze(draft.sequence.map((o) => Object.freeze(o)));
  const pos = sequence.findIndex((o) => o.id === draft.currentOccurrenceId);
  const current = pos >= 0 ? sequence[pos] : undefined;

  let nextOccurrenceId: string | null = null;
  if (draft.status === "ready") nextOccurrenceId = sequence[0]?.id ?? null;
  else if (draft.status === "active") nextOccurrenceId = sequence[pos + 1]?.id ?? null;

  return Object.freeze({
    ...draft,
    sequence,
    liveDeviations: Object.freeze([...draft.liveDeviations]),
    nextOccurrenceId,
    repetition: current
      ? { index: current.repetitionIndex + 1, total: draft.vamping ? null : current.repetitionCount }
      : { index: 0, total: 0 },
  });
}
