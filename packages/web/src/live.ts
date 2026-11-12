import type { CommandAck, PerformanceCommand, PerformanceState } from "@setflow/core";
import type { ClientRole, ConnectedClient, InputDevicesStatus, LiveStatus, MidiStatus, ServerMessage, SessionContent } from "@setflow/server/protocol";
import { api, clientId, newId } from "./api";

export interface LiveSnapshot {
  status: LiveStatus | null;
  content: SessionContent | null;
  connected: boolean;
  clients: ConnectedClient[];
  /** Devices approved, or asking, to send clicker presses (issue #4). */
  inputs: InputDevicesStatus | null;
}

type Pending = { resolve: (ack: CommandAck) => void; reject: (err: Error) => void; timer: number };

/** Presses beyond this many unanswered ones are refused rather than piling up. */
const MAX_QUEUED_COMMANDS = 8;

/** The later of two states of the same session; a state from another session never wins over the snapshot. */
function newest(snapshot: PerformanceState | null | undefined, ack: PerformanceState | null): PerformanceState | null | undefined {
  if (!snapshot || !ack || ack.sessionId !== snapshot.sessionId) return snapshot;
  return ack.revision > snapshot.revision ? ack : snapshot;
}

/**
 * One browser's connection to the host (spec §23). Applies only newer
 * snapshots, loads the matching content before showing a session as live, and
 * never queues commands while disconnected.
 */
export class LiveClient {
  private ws: WebSocket | null = null;
  private retryMs = 500;
  private snapshot: LiveSnapshot = { status: null, content: null, connected: false, clients: [], inputs: null };
  private readonly listeners = new Set<(s: LiveSnapshot) => void>();
  private readonly libraryListeners = new Set<() => void>();
  private readonly midiListeners = new Set<(status: MidiStatus) => void>();
  private readonly pending = new Map<string, Pending>();
  private queue: Promise<void> = Promise.resolve();
  private commands: Promise<unknown> = Promise.resolve();
  private inFlight = 0;
  /** Paired-input presses awaiting their answer, oldest first; the host answers in order. */
  private inputAnswers: Array<(message: string | null) => void> = [];
  /** State from the latest ack; snapshots apply asynchronously, so it can be ahead of `snapshot`. */
  private lastAckState: PerformanceState | null = null;
  private closed = false;

  constructor(private readonly role: ClientRole) {
    this.connect();
  }

  get current(): LiveSnapshot {
    return this.snapshot;
  }

  get isConductor(): boolean {
    return this.snapshot.status?.controllerId === clientId;
  }

  /** True when the MD has approved this device to send clicker presses. */
  get isPairedInput(): boolean {
    return this.snapshot.inputs?.approved.some((d) => d.clientId === clientId) ?? false;
  }

  /**
   * Send a clicker press from a paired device. The host submits it for the
   * conductor; resolves with why nothing happened, or null when it was applied.
   */
  input(type: "NEXT" | "PREVIOUS"): Promise<string | null> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.snapshot.connected) return Promise.resolve("Disconnected from the host");
    return new Promise((resolve) => {
      this.inputAnswers.push(resolve);
      ws.send(JSON.stringify({ type: "input", command: { type } }));
    });
  }

  subscribe(listener: (s: LiveSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  onLibraryChange(listener: () => void): () => void {
    this.libraryListeners.add(listener);
    return () => this.libraryListeners.delete(listener);
  }

  onMidi(listener: (status: MidiStatus) => void): () => void {
    this.midiListeners.add(listener);
    return () => this.midiListeners.delete(listener);
  }

  /**
   * Send a command to the host. Resolves with the host's acknowledgement.
   *
   * Presses are sent one at a time: each waits for the previous answer and
   * then carries the revision that answer produced. Without this, a second
   * clicker press made before the first ack would be rejected as stale. A
   * press is never held across a disconnect (spec §23); it fails instead.
   */
  command(command: PerformanceCommand): Promise<CommandAck> {
    if (this.inFlight >= MAX_QUEUED_COMMANDS) return Promise.reject(new Error("Too many presses waiting for the host"));
    this.inFlight++;
    const run = () => this.sendNow(command);
    const result = this.commands.then(run, run).finally(() => this.inFlight--);
    this.commands = result.catch(() => undefined);
    return result;
  }

  private sendNow(command: PerformanceCommand): Promise<CommandAck> {
    const state = newest(this.snapshot.status?.state, this.lastAckState);
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.snapshot.connected) {
      return Promise.reject(new Error("Disconnected from the host"));
    }
    if (!state) return Promise.reject(new Error("No performance is running"));
    const commandId = newId();
    const envelope = {
      commandId,
      sessionId: state.sessionId,
      expectedRevision: state.revision,
      source: "web" as const,
      controllerId: clientId,
      command,
    };
    return new Promise<CommandAck>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(commandId);
        reject(new Error("The host did not answer in time"));
      }, 4000);
      this.pending.set(commandId, { resolve, reject, timer });
      ws.send(JSON.stringify({ type: "command", envelope }));
    });
  }

  /** Re-read the host status, e.g. after an HTTP call that changed it. */
  refresh(status: LiveStatus): void {
    this.enqueue(status);
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  private connect(): void {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retryMs = 500;
      ws.send(JSON.stringify({ type: "hello", clientId, role: this.role }));
    };
    ws.onmessage = (event) => this.receive(JSON.parse(String(event.data)) as ServerMessage);
    ws.onclose = () => {
      this.ws = null;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("Disconnected from the host"));
        this.pending.delete(id);
      }
      for (const answer of this.inputAnswers.splice(0)) answer("Disconnected from the host");
      this.update({ connected: false });
      if (!this.closed) {
        window.setTimeout(() => this.connect(), this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, 4000);
      }
    };
  }

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case "status":
        this.enqueue(message.status, true);
        break;
      case "ack": {
        this.lastAckState = message.ack.state;
        if (this.snapshot.status)this.enqueue({ ...this.snapshot.status, state: message.ack.state });
        const pending = this.pending.get(message.ack.commandId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(message.ack.commandId);
          pending.resolve(message.ack);
        }
        break;
      }
      case "clients":
        this.update({ clients: message.clients });
        break;
      case "inputs":
        this.update({ inputs: message.inputs });
        break;
      case "inputResult":
        this.inputAnswers.shift()?.(message.accepted ? null : message.message);
        break;
      case "midi":
        for (const l of this.midiListeners) l(message.status);
        break;
      case "library":
        for (const l of this.libraryListeners) l();
        break;
      case "error":
        console.warn("SetFlow host:", message.message);
        break;
    }
  }

  /** Apply snapshots one at a time, so content for a new session is loaded before it is shown. */
  private enqueue(status: LiveStatus, fromHost = false): void {
    this.queue = this.queue.then(() => this.accept(status, fromHost)).catch((err) => console.error(err));
  }

  private async accept(status: LiveStatus, fromHost: boolean): Promise<void> {
    const prev = this.snapshot.status?.state;
    const next = status.state;
    if (prev && next && prev.sessionId === next.sessionId && next.revision < prev.revision) return;

    let content = this.snapshot.content;
    if (!next) content = null;
    else if (content?.sessionId !== next.sessionId) {
      content = await api<SessionContent>("GET", "/api/session/content");
      if (content.sessionId !== next.sessionId) return; // A newer session started meanwhile; its status follows.
    }
    this.update({ status, content, connected: fromHost || this.snapshot.connected });
  }

  private update(patch: Partial<LiveSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l(this.snapshot);
  }
}
