import type { CommandAck, PerformanceCommand } from "@setflow/core";
import type { ClientRole, ConnectedClient, LiveStatus, ServerMessage, SessionContent } from "@setflow/server/protocol";
import { api, clientId, newId } from "./api";

export interface LiveSnapshot {
  status: LiveStatus | null;
  content: SessionContent | null;
  connected: boolean;
  clients: ConnectedClient[];
}

type Pending = { resolve: (ack: CommandAck) => void; reject: (err: Error) => void; timer: number };

/**
 * One browser's connection to the host (spec §23). Applies only newer
 * snapshots, loads the matching content before showing a session as live, and
 * never queues commands while disconnected.
 */
export class LiveClient {
  private ws: WebSocket | null = null;
  private retryMs = 500;
  private snapshot: LiveSnapshot = { status: null, content: null, connected: false, clients: [] };
  private readonly listeners = new Set<(s: LiveSnapshot) => void>();
  private readonly libraryListeners = new Set<() => void>();
  private readonly pending = new Map<string, Pending>();
  private queue: Promise<void> = Promise.resolve();
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

  subscribe(listener: (s: LiveSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  onLibraryChange(listener: () => void): () => void {
    this.libraryListeners.add(listener);
    return () => this.libraryListeners.delete(listener);
  }

  /** Send a command to the host. Resolves with the host's acknowledgement. */
  command(command: PerformanceCommand): Promise<CommandAck> {
    const state = this.snapshot.status?.state;
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
        if (this.snapshot.status) this.enqueue({ ...this.snapshot.status, state: message.ack.state });
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
