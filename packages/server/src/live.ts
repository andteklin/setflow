import { randomUUID } from "node:crypto";
import {
  applyArrangement,
  chartLines,
  occurrenceLabel,
  parseChordPro,
  PerformanceSession,
  songMetadata,
  type ChartLine,
  type CommandAck,
  type CommandEnvelope,
  type ParsedSong,
  type PerformanceState,
  type SongMetadata,
} from "@setflow/core";
import { HttpError, resolveSongMap, summarizeSections, type Library, type SectionSummary } from "./library.js";
import type { PinnedContent, RecoverySnapshot, Store } from "./store.js";

/** Everything a view needs to render the pinned song. Fetched once per session id. */
export interface SessionContent {
  sessionId: string;
  songId: string;
  songRevision: number;
  title: string;
  arrangementId: string;
  arrangementName: string;
  songMap: string;
  metadata: SongMetadata;
  sections: Array<SectionSummary & { lines: ChartLine[] }>;
}

export interface RecoverySummary {
  title: string;
  arrangementName: string;
  current: string | null;
  status: PerformanceState["status"];
  savedAt: string;
}

/** The authoritative live status broadcast to every client. */
export interface LiveStatus {
  state: PerformanceState | null;
  controllerId: string | null;
  title: string | null;
  recovery: RecoverySummary | null;
}

export interface StartInput {
  songId?: string;
  arrangementId?: string;
  performanceKey?: string;
  controllerId?: string;
}

/**
 * Runs the one active performance on this host (spec §19.1). The session is
 * pinned to the song text and arrangement it started from: library edits made
 * meanwhile apply to the next session, never the current one (spec §2.3).
 */
export class LiveHost {
  private session: PerformanceSession | null = null;
  private pinned: PinnedContent | null = null;
  private parsed: ParsedSong | null = null;
  private pendingRecovery: RecoverySnapshot | null = null;
  private readonly listeners = new Set<(status: LiveStatus) => void>();

  constructor(
    private readonly store: Store,
    private readonly library: Library,
  ) {
    const saved = store.loadRecovery();
    if (saved && saved.state.status !== "ended") this.pendingRecovery = saved;
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
    };
  }

  /** Start a new session from a saved arrangement. Replaces any current session. */
  start(input: StartInput): LiveStatus {
    const controllerId = requireController(input.controllerId);
    const song = this.library.getSong(input.songId ?? "");
    const arrangement = this.library.getArrangement(input.arrangementId ?? "");
    if (arrangement.songId !== song.id) throw new HttpError(400, "That arrangement belongs to a different song");

    const parsed = parseChordPro(song.sourceText);
    let items;
    try {
      items = resolveSongMap(parsed, arrangement.songMap);
    } catch (err) {
      throw new HttpError(400, `Arrangement "${arrangement.name}" no longer matches the song: ${(err as Error).message}`);
    }
    const performanceKey =
      input.performanceKey || arrangement.performanceKey || songMetadata(parsed).originalKey || "";

    this.pendingRecovery = null;
    this.parsed = parsed;
    this.pinned = {
      songId: song.id,
      songRevision: song.revision,
      title: song.title,
      sourceText: song.sourceText,
      arrangementId: arrangement.id,
      arrangementName: arrangement.name,
      songMap: arrangement.songMap,
    };
    this.session = new PerformanceSession({
      sessionId: randomUUID(),
      songId: song.id,
      arrangementId: arrangement.id,
      arrangementRevision: arrangement.revision,
      performanceKey,
      plannedSequence: applyArrangement(parsed, items),
      sectionIds: parsed.sections.map((s) => s.id),
      controllerId,
    });
    return this.changed();
  }

  submit(envelope: CommandEnvelope): CommandAck {
    const session = this.requireSession();
    const before = session.state;
    const ack = session.submit(envelope);
    if (session.state !== before) this.changed();
    return ack;
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
    return {
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
      if (this.session.state.status === "ended") {
        this.store.clearRecovery();
      } else {
        this.store.saveRecovery({
          state: this.session.state,
          pinned: this.pinned,
          controllerId: this.session.controllerId,
          savedAt: new Date().toISOString(),
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

function summarize(saved: RecoverySnapshot): RecoverySummary {
  const parsed = parseChordPro(saved.pinned.sourceText);
  const occurrence = saved.state.sequence.find((o) => o.id === saved.state.currentOccurrenceId);
  const section = occurrence && parsed.sections.find((s) => s.id === occurrence.sectionId);
  return {
    title: saved.pinned.title,
    arrangementName: saved.pinned.arrangementName,
    current: occurrence && section ? occurrenceLabel(section, occurrence) : null,
    status: saved.state.status,
    savedAt: saved.savedAt,
  };
}
