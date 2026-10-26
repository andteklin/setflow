import {
  applyCommand,
  createPerformance,
  resumePerformance,
  setCues,
  setPerformanceKey,
  type PerformanceCommand,
  type PerformanceInit,
  type PerformanceState,
} from "./performance.js";

export type InputSource = "web" | "keyboard" | "midi" | "gpio";

/** What an input adapter sends to the host (spec §19.1). A retry reuses its `commandId`. */
export interface CommandEnvelope {
  commandId: string;
  sessionId: string;
  expectedRevision: number;
  source: InputSource;
  controllerId: string;
  command: PerformanceCommand;
}

export type RejectReason = "wrong-session" | "unauthorized" | "stale-revision" | "invalid-command";

/** Every reply carries the authoritative snapshot, so a rejected client can resync. */
export type CommandAck =
  | { commandId: string; accepted: true; duplicate: boolean; revision: number; state: PerformanceState }
  | {
      commandId: string;
      accepted: false;
      duplicate: boolean;
      reason: RejectReason;
      message: string;
      revision: number;
      state: PerformanceState;
    };

export interface SessionInit extends PerformanceInit {
  /** Section ids of the song being performed; JUMP targets must be one of these. */
  sectionIds: Iterable<string>;
  /** The one controller allowed to conduct. Musician views are view-only. */
  controllerId: string;
}

/**
 * The host's command gateway for one live session (spec §19.3). Commands are
 * applied one at a time in arrival order. Each is checked for session,
 * controller and expected revision; a retried `commandId` gets its original
 * answer back instead of running twice. Holds no I/O: the server feeds it
 * envelopes and broadcasts `state` after accepted changes.
 */
export class PerformanceSession {
  private current: PerformanceState;
  private controller: string;
  private readonly sectionIds: ReadonlySet<string>;
  private readonly answered = new Map<string, Omit<CommandAck, "duplicate" | "state">>();

  constructor(init: SessionInit) {
    this.current = createPerformance(init);
    this.controller = init.controllerId;
    this.sectionIds = new Set(init.sectionIds);
  }

  /** Continue a recovered snapshot under a new session id. The operator confirms before this is called. */
  static resume(
    previous: PerformanceState,
    init: { sessionId: string; sectionIds: Iterable<string>; controllerId: string },
  ): PerformanceSession {
    const session = new PerformanceSession({ ...previous, ...init });
    session.current = resumePerformance(previous, init.sessionId);
    return session;
  }

  get state(): PerformanceState {
    return this.current;
  }

  get sessionId(): string {
    return this.current.sessionId;
  }

  get controllerId(): string {
    return this.controller;
  }

  /** Hand conducting to another controller, e.g. when the MD switches devices. */
  setController(controllerId: string): void {
    this.controller = controllerId;
  }

  submit(envelope: CommandEnvelope): CommandAck {
    const prior = this.answered.get(envelope.commandId);
    if (prior) return { ...prior, duplicate: true, state: this.current } as CommandAck;

    const ack = this.decide(envelope);
    // Only remember answers that belong to this session; a foreign id may be reused there.
    if (!(ack.accepted === false && ack.reason === "wrong-session")) {
      const { duplicate: _d, state: _s, ...stored } = ack;
      this.answered.set(envelope.commandId, stored);
    }
    return ack;
  }

  setPerformanceKey(performanceKey: string): PerformanceState {
    this.current = setPerformanceKey(this.current, performanceKey);
    return this.current;
  }

  setCues(cues: readonly string[]): PerformanceState {
    this.current = setCues(this.current, cues);
    return this.current;
  }

  private decide(envelope: CommandEnvelope): CommandAck {
    const reject = (reason: RejectReason, message: string): CommandAck => ({
      commandId: envelope.commandId,
      accepted: false,
      duplicate: false,
      reason,
      message,
      revision: this.current.revision,
      state: this.current,
    });

    if (envelope.sessionId !== this.current.sessionId) {
      return reject("wrong-session", `Command is for session ${envelope.sessionId}, not ${this.current.sessionId}`);
    }
    if (envelope.controllerId !== this.controller) {
      return reject("unauthorized", `Controller ${envelope.controllerId} is not conducting this session`);
    }
    if (envelope.expectedRevision !== this.current.revision) {
      return reject(
        "stale-revision",
        `Command expected revision ${envelope.expectedRevision}, but the session is at ${this.current.revision}`,
      );
    }

    const result = applyCommand(this.current, envelope.command, {
      commandId: envelope.commandId,
      sectionIds: this.sectionIds,
    });
    if (!result.ok) return reject("invalid-command", result.error);

    this.current = result.state;
    return {
      commandId: envelope.commandId,
      accepted: true,
      duplicate: false,
      revision: this.current.revision,
      state: this.current,
    };
  }
}
