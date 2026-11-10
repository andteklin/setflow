import { randomUUID } from "node:crypto";
import {
  applyArrangement,
  chartLines,
  notesByOccurrence,
  occurrenceLabel,
  parseChartLine,
  parseChordPro,
  PerformanceSession,
  songMetadata,
  type CommandAck,
  type CommandEnvelope,
  type ParsedSong,
  type PerformanceCommand,
} from "@setflow/core";
import { HttpError, resolveSongMap, summarizeSections, type Library } from "./library.js";
import type { LiveStatus, RecoverySummary, ServiceStatus, SessionContent } from "./protocol.js";
import type { PinnedContent, RecoverySnapshot, ServiceItemPin, ServiceSnapshot, Store } from "./store.js";

export interface StartInput {
  songId?: string;
  arrangementId?: string;
  performanceKey?: string;
  controllerId?: string;
}

export interface StartSetlistInput {
  setlistId?: string;
  controllerId?: string;
  /** Entry to load first; default 0. */
  index?: number;
}

/** What a song needs to become a live session: its pinned text and map, and a key. */
interface Pin extends PinnedContent {
  arrangementRevision: number;
  performanceKey: string;
}

/**
 * Runs the one active performance on this host (spec §19.1). The session is
 * pinned to the song text and arrangement it started from: library edits made
 * meanwhile apply to the next session, never the current one (spec §2.3).
 *
 * A setlist can be performed as one service (issue #7). Every entry is
 * pinned when the setlist starts, and the gateway moves between them: NEXT
 * after a song has ended loads the next song at Ready, and PREVIOUS at Ready
 * goes back one. Each song is still its own session with its own id.
 */
export class LiveHost {
  private session: PerformanceSession | null = null;
  private pinned: PinnedContent | null = null;
  private parsed: ParsedSong | null = null;
  private service: ServiceSnapshot | null = null;
  private pendingRecovery: RecoverySnapshot | null = null;
  /** The last command that changed songs, so a retry of it is answered instead of rejected. */
  private lastSongChange: CommandAck | null = null;
  private readonly listeners = new Set<(status: LiveStatus) => void>();

  constructor(
    private readonly store: Store,
    private readonly library: Library,
  ) {
    const saved = store.loadRecovery();
    // An ended song is still worth resuming when setlist songs follow it.
    const songsLeft = saved?.service ? saved.service.index < saved.service.items.length - 1 : false;
    if (saved && (saved.state.status !== "ended" || songsLeft)) this.pendingRecovery = saved;
  }

  onChange(listener: (status: LiveStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  status(): LiveStatus {
    return {
      state: this.session?.state ?? null,
      controllerId: this.session?.controllerId ?? null,
      title: this.pinned?.title ?? null,
      recovery: this.pendingRecovery && summarize(this.pendingRecovery),
      service: this.service && serviceStatus(this.service),
    };
  }

  /** Start one song from a saved arrangement, outside any setlist. Replaces any current session. */
  start(input: StartInput): LiveStatus {
    const controllerId = requireController(input.controllerId);
    const pin = this.pin(input.songId ?? "", input.arrangementId ?? "", input.performanceKey);
    this.service = null;
    this.begin(pin, controllerId);
    return this.changed();
  }

  /**
   * Start performing a setlist. Every entry is checked and pinned now, so a
   * broken map is found before the service rather than at song four, and
   * library edits during the service cannot change what comes next.
   */
  startSetlist(input: StartSetlistInput): LiveStatus {
    const controllerId = requireController(input.controllerId);
    const setlist = this.library.getSetlist(input.setlistId ?? "");
    if (setlist.items.length === 0) throw new HttpError(400, `Setlist "${setlist.name}" has no songs`);
    const index = input.index ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= setlist.items.length) {
      throw new HttpError(400, `Setlist "${setlist.name}" has no song ${index + 1}`);
    }

    const items: ServiceItemPin[] = [];
    const problems: string[] = [];
    setlist.items.forEach((item, i) => {
      try {
        items.push({ ...this.pin(item.songId, item.arrangementId, item.performanceKey), itemId: item.itemId });
      } catch (err) {
        problems.push(`${i + 1}. ${(err as Error).message}`);
      }
    });
    if (problems.length > 0) {
      throw new HttpError(400, `Setlist "${setlist.name}" is not ready:\n${problems.join("\n")}`);
    }

    this.service = { setlistId: setlist.id, name: setlist.name, index, items };
    this.begin(items[index], controllerId);
    return this.changed();
  }

  /** Load another song of the running setlist at Ready (Control's song list and prev/next-song buttons). */
  goToSong(controllerId: unknown, index: unknown): LiveStatus {
    const session = this.requireConductor(controllerId);
    const service = this.service;
    if (!service) throw new HttpError(409, "No setlist is running");
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= service.items.length) {
      throw new HttpError(400, `The setlist has no song ${typeof index === "number" ? index + 1 : index}`);
    }
    service.index = index;
    this.begin(service.items[index], session.controllerId);
    return this.changed();
  }

  submit(envelope: CommandEnvelope): CommandAck {
    const session = this.requireSession();
    const songChange = this.changeSong(envelope);
    if (songChange) return songChange;
    const before = session.state;
    const ack = session.submit(envelope);
    if (session.state !== before) this.changed();
    return ack;
  }

  /**
   * Submit a command from an input attached to the host itself (MIDI), or
   * one relayed for a paired device, on behalf of the conducting controller.
   * It always carries the current revision, so it can't be stale. Returns an
   * error message, or null.
   */
  conduct(command: PerformanceCommand, source: "midi" | "gpio" | "keyboard"): string | null {
    const session = this.session;
    if (!session) return "No performance is running";
    const ack = this.submit({
      commandId: randomUUID(),
      sessionId: session.sessionId,
      expectedRevision: session.state.revision,
      source,
      controllerId: session.controllerId,
      command,
    });
    return ack.accepted ? null : ack.message;
  }

  /** Sections of the pinned song, for resolving MIDI jump tokens. */
  sections(): ReadonlyArray<{ id: string; token: string }> {
    return this.session && this.parsed ? this.parsed.sections : [];
  }

  takeControl(controllerId: unknown): LiveStatus {
    this.requireSession().setController(requireController(controllerId));
    return this.changed();
  }

  setPerformanceKey(controllerId: unknown, performanceKey: unknown): LiveStatus {
    const session = this.requireConductor(controllerId);
    if (typeof performanceKey !== "string" || performanceKey.trim() === "") {
      throw new HttpError(400, "performanceKey is required");
    }
    session.setPerformanceKey(performanceKey.trim());
    return this.changed();
  }

  setCues(controllerId: unknown, cues: unknown): LiveStatus {
    const session = this.requireConductor(controllerId);
    if (!Array.isArray(cues) || cues.some((c) => typeof c !== "string")) {
      throw new HttpError(400, "cues must be a list of strings");
    }
    session.setCues(cues.map((c: string) => c.trim()).filter(Boolean));
    return this.changed();
  }

  content(): SessionContent {
    const session = this.requireSession();
    const pinned = this.pinned!;
    const parsed = this.parsed!;
    const lines = new Map(parsed.sections.map((s) => [s.id, chartLines(s)]));
    // Arrangement notes belong to planned occurrences, which keep their order whatever live commands insert.
    const planned = session.state.sequence.filter((o) => o.origin === "planned");
    const byOccurrence = notesByOccurrence(parsed, resolveSongMap(parsed, pinned.songMap), pinned.notes ?? []);
    const notes: SessionContent["notes"] = {};
    planned.forEach((occ, k) => {
      const here = byOccurrence[k] ?? [];
      if (here.length) notes[occ.id] = here.map((n) => ({ afterLine: n.afterLine, line: parseChartLine(n.text) }));
    });
    return {
      notes,
      sessionId: session.sessionId,
      songId: pinned.songId,
      songRevision: pinned.songRevision,
      title: pinned.title,
      arrangementId: pinned.arrangementId,
      arrangementName: pinned.arrangementName,
      songMap: pinned.songMap,
      metadata: songMetadata(parsed),
      sections: summarizeSections(parsed).map((s) => ({ ...s, lines: lines.get(s.id)! })),
    };
  }

  /** Continue the recovered snapshot after the operator confirms (spec §25). Never advances the band by itself. */
  resumeRecovery(controllerId: unknown): LiveStatus {
    const saved = this.pendingRecovery;
    if (!saved) throw new HttpError(409, "There is no performance to recover");
    const parsed = parseChordPro(saved.pinned.sourceText);
    this.parsed = parsed;
    this.pinned = saved.pinned;
    this.service = saved.service ?? null;
    this.session = PerformanceSession.resume(saved.state, {
      sessionId: randomUUID(),
      sectionIds: parsed.sections.map((s) => s.id),
      controllerId: requireController(controllerId),
    });
    this.pendingRecovery = null;
    return this.changed();
  }

  discardRecovery(): LiveStatus {
    this.pendingRecovery = null;
    this.store.clearRecovery();
    return this.changed();
  }

  /** Read a saved song and arrangement and freeze what a session needs from them. */
  private pin(songId: string, arrangementId: string, performanceKey: string | undefined): Pin {
    const song = this.library.getSong(songId);
    const arrangement = this.library.getArrangement(arrangementId);
    if (arrangement.songId !== song.id) throw new HttpError(400, "That arrangement belongs to a different song");
    const parsed = parseChordPro(song.sourceText);
    try {
      resolveSongMap(parsed, arrangement.songMap);
    } catch (err) {
      throw new HttpError(400, `"${song.title}": arrangement "${arrangement.name}" no longer matches the song: ${(err as Error).message}`);
    }
    return {
      songId: song.id,
      songRevision: song.revision,
      title: song.title,
      sourceText: song.sourceText,
      arrangementId: arrangement.id,
      arrangementName: arrangement.name,
      arrangementRevision: arrangement.revision,
      songMap: arrangement.songMap,
      notes: arrangement.notes,
      performanceKey: performanceKey || arrangement.performanceKey || songMetadata(parsed).originalKey || "",
    };
  }

  /** Replace the current session with a new one, at Ready, for a pinned song. */
  private begin(pin: Pin, controllerId: string): void {
    const parsed = parseChordPro(pin.sourceText);
    const items = resolveSongMap(parsed, pin.songMap);
    this.pendingRecovery = null;
    this.parsed = parsed;
    this.pinned = {
      songId: pin.songId,
      songRevision: pin.songRevision,
      title: pin.title,
      sourceText: pin.sourceText,
      arrangementId: pin.arrangementId,
      arrangementName: pin.arrangementName,
      songMap: pin.songMap,
      notes: pin.notes ?? [],
    };
    this.session = new PerformanceSession({
      sessionId: randomUUID(),
      songId: pin.songId,
      arrangementId: pin.arrangementId,
      arrangementRevision: pin.arrangementRevision,
      performanceKey: pin.performanceKey,
      plannedSequence: applyArrangement(parsed, items),
      sectionIds: parsed.sections.map((s) => s.id),
      controllerId,
    });
  }

  /**
   * Move between setlist songs through the command gateway, so web keys, a
   * clicker, MIDI and paired inputs all get it. Only two transitions qualify:
   * NEXT once the song has ended, and PREVIOUS before it has started. The
   * envelope must pass the same session, controller and revision checks as
   * any other command; otherwise it falls through and is rejected normally.
   */
  private changeSong(envelope: CommandEnvelope): CommandAck | null {
    if (this.lastSongChange?.commandId === envelope.commandId) {
      return { ...this.lastSongChange, duplicate: true, state: this.session!.state };
    }
    const session = this.session!;
    const service = this.service;
    const { state } = session;
    if (!service) return null;
    const type = envelope.command.type;
    const target =
      state.status === "ended" && type === "NEXT" ? service.index + 1 : state.status === "ready" && type === "PREVIOUS" ? service.index - 1 : null;
    if (target === null || target < 0 || target >= service.items.length) return null;
    if (
      envelope.sessionId !== state.sessionId ||
      envelope.controllerId !== session.controllerId ||
      envelope.expectedRevision !== state.revision
    ) {
      return null;
    }

    service.index = target;
    this.begin(service.items[target], session.controllerId);
    const next = this.session!.state;
    const ack: CommandAck = { commandId: envelope.commandId, accepted: true, duplicate: false, revision: next.revision, state: next };
    this.lastSongChange = ack;
    this.changed();
    return ack;
  }

  private requireSession(): PerformanceSession {
    if (!this.session) throw new HttpError(409, "No performance is running; start one from Control View");
    return this.session;
  }

  private requireConductor(controllerId: unknown): PerformanceSession {
    const session = this.requireSession();
    if (controllerId !== session.controllerId) throw new HttpError(403, "Only the conducting controller can do that");
    return session;
  }

  private changed(): LiveStatus {
    if (this.session && this.pinned) {
      const lastSong = !this.service || this.service.index >= this.service.items.length - 1;
      if (this.session.state.status === "ended" && lastSong) {
        this.store.clearRecovery();
      } else {
        // Mid-setlist, an ended song still has songs after it: keep the service recoverable.
        this.store.saveRecovery({
          state: this.session.state,
          pinned: this.pinned,
          controllerId: this.session.controllerId,
          savedAt: new Date().toISOString(),
          ...(this.service && { service: this.service }),
        });
      }
    }
    const status = this.status();
    for (const listener of this.listeners) listener(status);
    return status;
  }
}

function requireController(controllerId: unknown): string {
  if (typeof controllerId !== "string" || controllerId.trim() === "") {
    throw new HttpError(400, "controllerId is required");
  }
  return controllerId;
}

function serviceStatus(service: ServiceSnapshot): ServiceStatus {
  return {
    setlistId: service.setlistId,
    name: service.name,
    index: service.index,
    items: service.items.map((i) => ({ itemId: i.itemId, title: i.title, arrangementName: i.arrangementName, performanceKey: i.performanceKey })),
  };
}

function summarize(saved: RecoverySnapshot): RecoverySummary {
  const parsed = parseChordPro(saved.pinned.sourceText);
  const occurrence = saved.state.sequence.find((o) => o.id === saved.state.currentOccurrenceId);
  const section = occurrence && parsed.sections.find((s) => s.id === occurrence.sectionId);
  const service = saved.service;
  return {
    title: saved.pinned.title,
    setlist: service ? `${service.name} · song ${service.index + 1} of ${service.items.length}` : null,
    arrangementName: saved.pinned.arrangementName,
    current: occurrence && section ? occurrenceLabel(section, occurrence) : null,
    status: saved.state.status,
    savedAt: saved.savedAt,
  };
}
