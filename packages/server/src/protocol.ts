/**
 * Shapes exchanged between the host and its browser clients. Type-only and
 * free of Node imports so the web app can share them.
 */
import type { ArrangementItem, ArrangementNote, ChartLine, CommandAck, CommandEnvelope, PerformanceState, SongMetadata } from "@setflow/core";

/** Where a song came from (spec §16.1–16.2). Content stays on this host. */
export interface Provenance {
  providerId: "file" | "paste" | "manual";
  fileName?: string;
  importedAt: string;
  storagePolicy: "organization-local";
}

export interface SongRecord {
  id: string;
  title: string;
  /** The ChordPro exactly as imported or last edited. Reparsed on every read. */
  sourceText: string;
  revision: number;
  provenance: Provenance;
  createdAt: string;
  updatedAt: string;
}

/** A saved Song Map. Stored as map text ("I → V1 → B×2") so it survives source edits that renumber sections. */
export interface ArrangementRecord {
  id: string;
  songId: string;
  name: string;
  songMap: string;
  performanceKey: string | null;
  /** Comment lines that belong to this arrangement only, not the song (issue #9). */
  notes: ArrangementNote[];
  revision: number;
  updatedAt: string;
}

export interface SetlistItem {
  /** Stable identity of this entry, so the same song can appear twice. Assigned by the host when missing. */
  itemId: string;
  songId: string;
  arrangementId: string;
  performanceKey?: string;
}

export interface SetlistRecord {
  id: string;
  name: string;
  items: SetlistItem[];
  revision: number;
  updatedAt: string;
}

export interface SectionSummary {
  id: string;
  token: string;
  sourceLabel: string;
  displayLabel: string;
  type: string;
  lineCount: number;
}

export interface ImportPreview {
  metadata: SongMetadata;
  sections: SectionSummary[];
  sourceOrderMap: string;
  warnings: string[];
}

export interface ArrangementView extends ArrangementRecord {
  /** Resolved against the current song source; null when the map no longer matches it. */
  items: ArrangementItem[] | null;
  error: string | null;
}

export interface SongSummary {
  id: string;
  title: string;
  artist?: string;
  originalKey?: string;
  revision: number;
  sectionCount: number;
  provenance: Provenance;
  updatedAt: string;
}

export interface SongDetail {
  song: SongRecord;
  metadata: SongMetadata;
  sections: SectionSummary[];
  arrangements: ArrangementView[];
}

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
  /**
   * The arrangement's own notes (issue #9), by planned occurrence id. Each goes
   * after `afterLine` of the section's lines. Occurrences inserted live have none.
   */
  notes: Record<string, Array<{ afterLine: number; line: ChartLine }>>;
}

export interface RecoverySummary {
  title: string;
  /** "Sunday · song 2 of 5" when the song was part of a setlist. */
  setlist: string | null;
  arrangementName: string;
  current: string | null;
  status: PerformanceState["status"];
  savedAt: string;
}

/** The setlist being performed, as every view shows it ("Song 2 of 5", "Next song: …"). */
export interface ServiceStatus {
  setlistId: string;
  name: string;
  /** 0-based index of the loaded song. */
  index: number;
  items: Array<{ itemId: string; title: string; arrangementName: string; performanceKey: string }>;
}

/** The authoritative live status broadcast to every client. */
export interface LiveStatus {
  state: PerformanceState | null;
  controllerId: string | null;
  title: string | null;
  recovery: RecoverySummary | null;
  /** Set while a setlist is being performed; null for a song started on its own. */
  service: ServiceStatus | null;
}

export type ClientRole = "control" | "stage" | "musician";

export interface ConnectedClient {
  clientId: string;
  role: ClientRole;
}

export interface HostInfo {
  urls: string[];
  clients: ConnectedClient[];
}

/** What a mapped MIDI button does. Jumps name a section by its exact token, e.g. "C1C". */
export type MidiAction = { type: "NEXT" | "PREVIOUS" | "REPEAT" | "VAMP" | "END" } | { type: "JUMP"; token: string };

export interface MidiBinding {
  kind: "note" | "cc";
  number: number;
  action: MidiAction;
}

export interface MidiSettings {
  enabled: boolean;
  deviceName: string | null;
  /** 1–16, or null to accept every channel. */
  channel: number | null;
  bindings: MidiBinding[];
}

export interface MidiEvent {
  kind: "note" | "cc";
  channel: number;
  number: number;
  value: number;
  press: boolean;
  at: string;
}

export interface MidiStatus {
  available: boolean;
  unavailableReason: string | null;
  devices: string[];
  connected: boolean;
  error: string | null;
  settings: MidiSettings;
  /** The last press received, for learning and testing mappings. */
  lastEvent: MidiEvent | null;
  /** What that press did: the action taken, or why nothing happened. */
  lastResult: string | null;
}

/** A device the MD approved to send clicker presses (issue #4). */
export interface InputDevice {
  clientId: string;
  label: string;
  approvedAt: string;
}

/** A device waiting for the MD to approve it. */
export interface InputRequest {
  clientId: string;
  label: string;
  requestedAt: string;
}

export interface InputDevicesStatus {
  approved: InputDevice[];
  pending: InputRequest[];
}

/** Messages the host sends over the LAN WebSocket. */
export type ServerMessage =
  | { type: "status"; status: LiveStatus }
  | { type: "midi"; status: MidiStatus }
  | { type: "inputs"; inputs: InputDevicesStatus }
  /** The answer to a paired device's press; `message` says why it did nothing. */
  | { type: "inputResult"; accepted: boolean; message: string | null }
  | { type: "ack"; ack: CommandAck }
  | { type: "clients"; clients: ConnectedClient[] }
  | { type: "library" }
  | { type: "error"; message: string };

/** Messages clients send. Commands carry the same envelope as the HTTP endpoint. */
export type ClientMessage =
  | { type: "hello"; clientId: string; role: ClientRole }
  | { type: "command"; envelope: CommandEnvelope }
  /** A clicker press from a paired device; the host submits it for the conductor. */
  | { type: "input"; command: { type: "NEXT" | "PREVIOUS" } };
